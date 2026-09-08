// 效率配对采样：独立 DSH_HOME + 交替顺序 + 认证预检 + 统一 finally 退出
// 用法：FIXTURE_DIR=<dir> ZAI_API_KEY=<key> [TESTED_SHA=<sha>] node sample.mjs
// 退出：统一 finally；任何 incomplete/failed → exit 1
import { spawn, execSync } from 'node:child_process'
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

// 有界 fetch 超时：覆盖完整请求周期（含响应体读取/解析）
async function fetchWithTimeout(url, opts, timeoutMs = 120000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal })
    // 超时覆盖到 body 读取完成——不在 fetch 返回后清 timer
    // 标记 body 已消费
    const text = await r.text() // text() 会等待完整 body——AbortSignal 仍有效
    clearTimeout(timer) // body 读取完成才清
    return { response: r, text, parsed: null }
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

async function api(path, body, timeoutMs = 120000) {
  const t0 = Date.now()
  try {
    const { response, text } = await fetchWithTimeout(`http://127.0.0.1:${PORT}/api/plugins/grokbot${path}?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    }, timeoutMs)
    let j
    try { j = JSON.parse(text) } catch { j = { error: 'invalid JSON response' } }
    return { ms: Date.now() - t0, http: response.status, ...j }
  } catch (e) {
    const isAbort = e.name === 'AbortError'
    return { ms: Date.now() - t0, status: 'fetch_error', error: isAbort ? `timeout after ${timeoutMs}ms` : e.message }
  }
}

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

// ===== 采样结果归一化（统一规范） =====
function normalizeSample(raw) {
  // raw 展开后的 status 可能被 ...j 覆盖——从 raw（不展开的原始值）取
  const isFetchError = raw.status === 'fetch_error' || raw.error?.includes('timeout')
  const isCancelled = raw.cancelled === true
  const isEmpty = !raw.reply || raw.reply?.includes('未能给出文本回复')
  const isHttpErr = raw.http >= 400
  if (isFetchError || isCancelled || isEmpty || isHttpErr || raw.error) {
    return { ...raw, status: isCancelled ? 'cancelled' : 'failed' }
  }
  return { ...raw, status: raw.status || 'ok' }
}

// 工具任务验证：检查实际工具执行证据（activity 含工具名）
function hasToolEvidence(sample) {
  if (!sample.activity || !Array.isArray(sample.activity)) return false
  return sample.activity.some(a => typeof a === 'string' && (a.includes('bash') || a.includes('exec')))
}

// 冷暖交替
function alternatingOrder(round) {
  return round % 2 === 1 ? ['direct', 'plugin'] : ['plugin', 'direct']
}

const QA = '配对冷A：只回复 OK。'
const TOOL = '配对冷B：用 bash 执行 echo COLD-TOOL 并回复输出。'

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
    return
  }
  console.log(`[preflight] model call OK (${preflight.ms}ms)`)

  // ===== 冷↔冷 问答 ×4（交替先后） =====
  console.log('\n== 冷↔冷 问答（交替先后） ==')
  for (let i = 1; i <= 4; i++) {
    const order = alternatingOrder(i)
    for (const side of order) {
      if (side === 'direct') {
        const d = await api('/__perf/direct', { text: QA })
        const s = normalizeSample({ ...d, round: i, pair: 'cold-qa', side: 'direct', order: order.indexOf('direct')+1 })
        results.push(s)
        console.log(`  ${i}D: ${s.ms}ms status=${s.status} tools=${d.toolCalls ?? 'N/A'}`)
      } else {
        const bid = await mkBot(`冷${i}`)
        const p = await api(`/conversations/${bid}/chat`, { text: QA })
        // 插件侧：不用 reply 存在推断成功——检查实际回复内容
        const replyText = (p.reply || '').trim()
        const isPlaceholder = replyText.startsWith('[') && replyText.includes('未能给出')
        const s = normalizeSample({ ...p, round: i, pair: 'cold-qa', side: 'plugin', order: order.indexOf('plugin')+1, botId: bid,
          status: isPlaceholder ? 'empty' : (replyText ? 'ok' : 'empty'),
          reply: replyText.slice(0, 20) })
        results.push(s)
        console.log(`  ${i}P: ${p.ms}ms status=${s.status}`)
        await rmBot(bid)
      }
    }
  }

  // ===== 冷↔冷 工具 ×2（交替先后） =====
  console.log('\n== 冷↔冷 工具（交替先后） ==')
  for (let i = 1; i <= 2; i++) {
    const order = alternatingOrder(i + 4)
    for (const side of order) {
      if (side === 'direct') {
        const d = await api('/__perf/direct', { text: TOOL })
        // 工具证据：toolCalls > 0
        const hasTools = (d.toolCalls ?? 0) > 0
        const s = normalizeSample({ ...d, round: i, pair: 'cold-tool', side: 'direct', order: order.indexOf('direct')+1,
          status: d.status === 'ok' && hasTools ? 'ok' : (d.status === 'ok' ? 'failed' : d.status),
          toolEvidence: hasTools })
        results.push(s)
        console.log(`  ${i}D: ${s.ms}ms tools=${d.toolCalls} evidence=${hasTools} status=${s.status}`)
      } else {
        const bid = await mkBot(`工具${i}`)
        const p = await api(`/conversations/${bid}/chat`, { text: TOOL })
        // 插件工具证据：activity 数组含 bash/exec 工具调用
        const hasTools = hasToolEvidence(p)
        const replyText = (p.reply || '').trim()
        const targetMatch = replyText.includes('COLD-TOOL')
        const s = normalizeSample({ ...p, round: i, pair: 'cold-tool', side: 'plugin', order: order.indexOf('plugin')+1, botId: bid,
          status: hasTools && targetMatch ? 'ok' : 'failed',
          toolEvidence: hasTools, targetMatch,
          reply: replyText.slice(0, 30) })
        results.push(s)
        console.log(`  ${i}P: ${p.ms}ms tools=${hasTools} target=${targetMatch} status=${s.status}`)
        await rmBot(bid)
      }
    }
  }

  // ===== 暖插件 ×5（独立 bot 预热 + 连续同 session、同文本） =====
  console.log('\n== 暖插件（预热1次 + 采样5次同文本） ==')
  const warmBot = await mkBot('暖采样')
  const warmup = await api(`/conversations/${warmBot}/chat`, { text: '预热：只回复 OK。' })
  const warmupOk = warmup.reply && !warmup.reply.includes('未能给出')
  console.log(`  warmup: ${warmup.ms}ms ok=${warmupOk} (excluded)`)
  if (!warmupOk) {
    console.log('  WARNING: warmup failed — warm samples may be unreliable')
    overallStatus = 'incomplete'
  }
  for (let i = 1; i <= 5; i++) {
    const p = await api(`/conversations/${warmBot}/chat`, { text: QA })
    const replyText = (p.reply || '').trim()
    const s = normalizeSample({ ...p, round: i, pair: 'warm-plugin', side: 'plugin', botId: warmBot,
      status: replyText && !replyText.includes('未能给出') ? 'ok' : 'empty',
      reply: replyText.slice(0, 20) })
    results.push(s)
    console.log(`  ${i}: ${p.ms}ms status=${s.status}`)
  }
  await rmBot(warmBot)

  // ===== 暖直连（fixture 私有 handle——当前未实现，标记 incomplete） =====
  console.log('\n== 暖直连（未实现：需 fixture 私有 handle） ==')
  results.push({ pair: 'warm-direct', side: 'direct', status: 'blocked', reason: 'fixture private handle not yet implemented' })
  // 暖直连缺失 → 整体 incomplete（不可报告通过）
  overallStatus = 'incomplete'

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

  const output = { commit, libHash, fixtureDir: FIXTURE_HOME, timestamp: new Date().toISOString(), model: 'zai/glm-5.3', overall: overallStatus, summary, samples: results }
  writeFileSync(`${FIXTURE_HOME}/paired-results.json`, JSON.stringify(output, null, 2))
  console.log(`\n[sampling] overall=${overallStatus} summary=${JSON.stringify(summary)}`)
  console.log(`[sampling] → ${FIXTURE_HOME}/paired-results.json`)

  if (overallStatus !== 'ok') process.exitCode = 1
}

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
