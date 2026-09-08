// 效率配对采样：独立 DSH_HOME + 交替顺序 + 认证预检 + 统一 finally 退出
// 用法：FIXTURE_DIR=<dir> ZAI_API_KEY=<key> [TESTED_SHA=<sha>] node sample.mjs
// 退出：统一 finally；任何 incomplete/failed → exit 1
import { spawn, execSync } from 'node:child_process'
import { runSampling } from './orchestrate.mjs'
import { makeClient } from './client.mjs'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { realpathSync } from 'node:fs'

const PORT = 27900 + Math.floor(Math.random() * 200)
const DSH_BIN = '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js'

// fixture 目录从环境变量获取（setup.sh 输出）
const FIXTURE_HOME = process.env.FIXTURE_DIR
if (!FIXTURE_HOME || !existsSync(join(FIXTURE_HOME, '.dsh-perf-fixture-owner'))) {
  console.error('[preflight] FAIL: FIXTURE_DIR not set or not a fixture directory')
  process.exit(1)
}

// SHA：优先显式传入 TESTED_SHA；否则从 fixture 链接解析（realpath 解析符号链接）
let commit = process.env.TESTED_SHA || 'unknown'
let libHash = 'unknown'
if (commit === 'unknown') {
  try {
    const grokbotLink = join(FIXTURE_HOME, 'profiles/web/node_modules/dsh-grokbot')
    const realPath = realpathSync(grokbotLink) // realpath 解析符号链接
    commit = execSync('git rev-parse HEAD', { cwd: realPath }).toString().trim().slice(0, 12)
  } catch { /* git 不可用时保留 unknown——但 unknown 会导致 incomplete */ }
}
// 产物 hash：lib/index.mjs 的 SHA-256 前 16 位
try {
  const lib = readFileSync(join(FIXTURE_HOME, 'profiles/web/node_modules/dsh-grokbot/lib/index.mjs'))
  const { createHash } = await import('node:crypto')
  libHash = createHash('sha256').update(lib).digest('hex').slice(0, 16)
} catch { /* 读不到 → unknown */ }

if (commit === 'unknown' || libHash === 'unknown') {
  console.error('[preflight] FAIL: cannot determine tested SHA or lib hash')
  console.error(`  commit=${commit} libHash=${libHash}`)
  console.error('  Pass TESTED_SHA=<sha> explicitly, or ensure git is accessible from the fixture link.')
  process.exit(1)
}

// ===== 认证预检 =====
if (!process.env.ZAI_API_KEY) {
  console.error('[preflight] FAIL: ZAI_API_KEY not set')
  process.exit(1)
}

console.log(`[sampling] commit=${commit} libHash=${libHash} port=${PORT} fixture=${FIXTURE_HOME}`)

// ===== 统一生命周期管理 =====
const child = spawn('node', [DSH_BIN, '--profile','web','--port',String(PORT),'--host','127.0.0.1','--no-open'], {
  env: { ...process.env, DSH_HOME: FIXTURE_HOME },
  stdio: ['ignore','pipe','pipe'],
})
let childExited = false
let childExitInfo = { code: null, signal: null }
child.on('exit', (code, signal) => { childExited = true; childExitInfo = { code, signal } })
child.on('error', (err) => { console.error('[child] error:', err.message); childExited = true })

child.stderr.on('data', (d) => {
  const s = d.toString().trim()
  if (s && !s.includes('Warning')) console.error('[stderr]', s.slice(0, 200))
})

let token = ''
const results = []
let overallStatus = 'ok' // ok | incomplete | failed

// 采样客户端：rttMs 独立字段（客户端往返），响应体字段原样合入不覆盖
const { api, fetchWithTimeout } = makeClient({ baseUrl: `http://127.0.0.1:${PORT}/api/plugins/grokbot`, token: () => token })

async function mkBot(name) {
  try {
    const { response, text } = await fetchWithTimeout(`http://127.0.0.1:${PORT}/api/plugins/grokbot/bots?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, title: '采样' })
    }, 30000)
    return (JSON.parse(text)).bot?.id
  } catch { return undefined }
}
async function rmBot(id) {
  if (!id) return
  try {
    await fetchWithTimeout(`http://127.0.0.1:${PORT}/api/plugins/grokbot/bots/${id}?token=${token}`, { method: 'DELETE' }, 10000)
  } catch { /* best effort */ }
}

// ===== 主流程 =====
async function main() {
  // 等待启动（有界）
  const startDeadline = Date.now() + 25000
  while (!token && Date.now() < startDeadline && !childExited) {
    await new Promise(r => {
      const t = setTimeout(r, 500)
      child.stdout.once('data', (d) => {
        const m = d.toString().match(/token=([^\s]+)/)
        if (m) { token = m[1]; clearTimeout(t); r() }
      })
    })
  }
  if (!token) throw new Error(childExited ? `harness exited early (code=${childExitInfo.code}, signal=${childExitInfo.signal})` : 'harness start timeout (25s)')
  console.log('[sampling] harness ready')

  // 认证预检
  const preflight = await api('/__perf/direct', { text: '预检：只回复 OK。' })
  if (preflight.status !== 'ok') {
    console.error(`[preflight] FAIL: status=${preflight.status} error=${preflight.error}`)
    overallStatus = 'incomplete'
    process.exitCode = 1 // Auth failure must exit non-zero
    return
  }
  console.log(`[preflight] model call OK (${preflight.ms}ms)`)

  // ===== 采样编排（可测核心 orchestrate.mjs；本文件只提供真实依赖） =====
  const sampling = await runSampling({
    api, mkBot, rmBot,
    log: (line) => console.log(line),
  })
  results.push(...sampling.results)
  overallStatus = sampling.overall === 'failed' ? 'failed' : (sampling.overall === 'ok' ? 'ok' : 'incomplete')
  if (sampling.exitCode !== 0) process.exitCode = sampling.exitCode

  // ===== 汇总（统一判定：非 ok 状态均不计通过） =====
  const nonOk = results.filter(r => r.status !== 'ok')
  const summary = {
    total: results.length,
    ok: results.filter(r => r.status === 'ok').length,
    failed: results.filter(r => r.status === 'failed').length,
    cancelled: results.filter(r => r.status === 'cancelled').length,
    empty: results.filter(r => r.status === 'empty').length,
    blocked: results.filter(r => r.status === 'blocked').length,
  }
  if (nonOk.length > 0) overallStatus = overallStatus === 'incomplete' ? 'incomplete' : (summary.failed > 0 ? 'failed' : 'incomplete')

  const output = { commit, libHash, fixtureDir: FIXTURE_HOME, timestamp: new Date().toISOString(),
    models: sampling.models, // 每配对实际 provider/model 与匹配条件（unknown/false → incomplete）
    overall: overallStatus, summary, samples: results }
  writeFileSync(`${FIXTURE_HOME}/paired-results.json`, JSON.stringify(output, null, 2))
  console.log(`\n[sampling] overall=${overallStatus} summary=${JSON.stringify(summary)}`)
  console.log(`[sampling] → ${FIXTURE_HOME}/paired-results.json`)

  // Unified exit code: any non-ok overall → 1 (covers all return paths)
  if (overallStatus !== 'ok') process.exitCode = 1
}

// Post-main() unified exit code mapping: even if main() returns early (preflight fail, warmup fail),
// overallStatus is checked here — not just at the end of the happy path
if (overallStatus !== 'ok') process.exitCode = 1

try {
  await main()
} catch (e) {
  console.error('[sampling] ERROR:', e.message)
  process.exitCode = 1
} finally {
  // 统一有界退出
  if (!childExited) {
    child.kill('SIGTERM')
    const deadline = Date.now() + 5000
    while (!childExited && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200))
    }
    if (!childExited) {
      console.warn('[sampling] child did not exit after SIGTERM+5s, SIGKILL')
      child.kill('SIGKILL')
      // 等待 exit 事件确认
      const killDeadline = Date.now() + 2000
      while (!childExited && Date.now() < killDeadline) {
        await new Promise(r => setTimeout(r, 100))
      }
    }
  }
  console.log(`[sampling] harness exited (code=${childExitInfo.code}, signal=${childExitInfo.signal})`)
}
