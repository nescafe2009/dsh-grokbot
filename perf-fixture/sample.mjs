// 效率配对采样：独立 DSH_HOME + 交替顺序 + 认证预检 + 统一 finally 退出
// 用法：FIXTURE_DIR=<dir> ZAI_API_KEY=<key> node sample.mjs
// 退出：统一 finally（SIGTERM 子进程 + 有界等待）
import { spawn, execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 27900 + Math.floor(Math.random() * 200)
const DSH_BIN = '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js'

// fixture 目录从环境变量获取（setup.sh 输出）
const FIXTURE_HOME = process.env.FIXTURE_DIR
if (!FIXTURE_HOME || !existsSync(join(FIXTURE_HOME, '.dsh-perf-fixture-owner'))) {
  console.error('[preflight] FAIL: FIXTURE_DIR not set or not a fixture directory (missing .dsh-perf-fixture-owner)')
  process.exit(1)
}

// SHA 从实际待测副本（fixture 链接的项目目录）获取——不用个人绝对路径
const grokbotLink = join(FIXTURE_HOME, 'profiles/web/node_modules/dsh-grokbot')
const projectDir = resolve(grokbotLink) // 解析符号链接
let commit = 'unknown'
try {
  commit = execSync('git rev-parse HEAD', { cwd: projectDir }).toString().trim().slice(0, 12)
} catch { /* git 不可用时保留 unknown */ }

// ===== 认证预检（变量名检查——不打印值） =====
if (!process.env.ZAI_API_KEY) {
  console.error('[preflight] FAIL: ZAI_API_KEY not set')
  process.exit(1)
}

console.log(`[sampling] commit=${commit} port=${PORT} fixture=${FIXTURE_HOME}`)

// ===== 统一生命周期管理 =====
const child = spawn('node', [DSH_BIN, '--profile','web','--port',String(PORT),'--host','127.0.0.1','--no-open'], {
  env: { ...process.env, DSH_HOME: FIXTURE_HOME },
  stdio: ['ignore','pipe','pipe'],
})

// stderr 消费（防缓冲区满阻塞）
child.stderr.on('data', (d) => {
  const s = d.toString().trim()
  if (s && !s.includes('Warning')) console.error('[stderr]', s.slice(0, 200))
})

let token = ''
const results = []

// 有界 fetch 超时
async function fetchWithTimeout(url, opts, timeoutMs = 120000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally { clearTimeout(timer) }
}

async function api(path, body, timeoutMs = 120000) {
  const t0 = Date.now()
  try {
    const r = await fetchWithTimeout(`http://127.0.0.1:${PORT}/api/plugins/grokbot${path}?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    }, timeoutMs)
    const j = await r.json()
    return { ms: Date.now() - t0, http: r.status, ...j }
  } catch (e) {
    return { ms: Date.now() - t0, status: 'fetch_error', error: e.message }
  }
}
async function mkBot(name) {
  const r = await fetchWithTimeout(`http://127.0.0.1:${PORT}/api/plugins/grokbot/bots?token=${token}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, title: '采样' })
  }, 30000)
  return (await r.json()).bot?.id
}
async function rmBot(id) {
  await fetchWithTimeout(`http://127.0.0.1:${PORT}/api/plugins/grokbot/bots/${id}?token=${token}`, { method: 'DELETE' }, 10000).catch(() => {})
}

// 冷暖交替：每轮随机或交替先后
function alternatingOrder(round) {
  return round % 2 === 1 ? ['direct', 'plugin'] : ['plugin', 'direct']
}

const QA = '配对冷A：只回复 OK。'
const TOOL = '配对冷B：用 bash 执行 echo COLD-TOOL 并回复输出。'

// ===== 主流程（统一 try/finally） =====
async function main() {
  // 等待启动（有界）
  const startDeadline = Date.now() + 25000
  while (!token && Date.now() < startDeadline) {
    await new Promise(r => {
      const t = setTimeout(r, 500)
      child.stdout.once('data', (d) => {
        const m = d.toString().match(/token=([^\s]+)/)
        if (m) { token = m[1]; clearTimeout(t); r() }
      })
    })
  }
  if (!token) throw new Error('harness start timeout (25s)')
  console.log('[sampling] harness ready')

  // 认证预检（真实调用）
  const preflight = await api('/__perf/direct', { text: '预检：只回复 OK。' })
  if (preflight.status !== 'ok') {
    console.error(`[preflight] FAIL: status=${preflight.status} error=${preflight.error}`)
    process.exitCode = 1
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
        results.push({ round: i, pair: 'cold-qa', side: 'direct', order: order.indexOf('direct')+1, ...d })
        console.log(`  ${i}D(${order.indexOf('direct')+1}): ${d.ms}ms status=${d.status} tools=${d.toolCalls}`)
      } else {
        const bid = await mkBot(`冷${i}`)
        const p = await api(`/conversations/${bid}/chat`, { text: QA })
        const ok = p.reply && !p.error && p.reply !== `[冷${i} 未能给出文本回复]`
        results.push({ round: i, pair: 'cold-qa', side: 'plugin', order: order.indexOf('plugin')+1, botId: bid, status: ok ? 'ok' : 'failed', reply: (p.reply||'').slice(0,20), ...p })
        console.log(`  ${i}P(${order.indexOf('plugin')+1}): ${p.ms}ms status=${ok ? 'ok' : 'failed'}`)
        await rmBot(bid)
      }
    }
  }

  // ===== 冷↔冷 工具 ×2（交替先后） =====
  console.log('\n== 冷↔冷 工具（交替先后） ==')
  for (let i = 1; i <= 2; i++) {
    const order = alternatingOrder(i + 4) // 偏移使工具轮的交替方向不同
    for (const side of order) {
      if (side === 'direct') {
        const d = await api('/__perf/direct', { text: TOOL })
        results.push({ round: i, pair: 'cold-tool', side: 'direct', order: order.indexOf('direct')+1, ...d })
        console.log(`  ${i}D: ${d.ms}ms tools=${d.toolCalls} status=${d.status}`)
      } else {
        const bid = await mkBot(`工具${i}`)
        const p = await api(`/conversations/${bid}/chat`, { text: TOOL })
        const ok = p.reply && !p.error && (p.reply||'').includes('COLD-TOOL')
        results.push({ round: i, pair: 'cold-tool', side: 'plugin', order: order.indexOf('plugin')+1, botId: bid, status: ok ? 'ok' : 'failed', reply: (p.reply||'').slice(0,30), ...p })
        console.log(`  ${i}P: ${p.ms}ms status=${ok ? 'ok' : 'failed'}`)
        await rmBot(bid)
      }
    }
  }

  // ===== 暖插件 ×5（独立 bot 预热 + 连续同 session、同文本） =====
  console.log('\n== 暖插件（预热1次不计 + 采样5次同文本） ==')
  const warmBot = await mkBot('暖采样')
  // 预热（不计入样本）
  const warmup = await api(`/conversations/${warmBot}/chat`, { text: '预热：只回复 OK。' })
  console.log(`  warmup: ${warmup.ms}ms status=${warmup.reply ? 'ok' : 'failed'} (excluded from samples)`)
  for (let i = 1; i <= 5; i++) {
    const p = await api(`/conversations/${warmBot}/chat`, { text: QA }) // 同文本（不变）
    const ok = p.reply && !p.error
    results.push({ round: i, pair: 'warm-plugin', side: 'plugin', botId: warmBot, status: ok ? 'ok' : 'failed', reply: (p.reply||'').slice(0,20), ...p })
    console.log(`  ${i}: ${p.ms}ms status=${ok ? 'ok' : 'failed'}`)
  }
  await rmBot(warmBot)

  // ===== 暖直连（需 session 复用——当前 __perf/direct 不支持，如实标注） =====
  console.log('\n== 暖直连（阻塞：直连端点不支持 session 复用） ==')
  results.push({ pair: 'warm-direct', side: 'direct', status: 'blocked', reason: 'no session reuse endpoint' })

  // ===== 任何 failed 样本 → 整体标记未通过 =====
  const failedCount = results.filter(r => r.status === 'failed' || r.status === 'fetch_error').length
  if (failedCount > 0) {
    console.log(`\n[sampling] WARNING: ${failedCount} failed samples — results marked as incomplete`)
  }

  // ===== 输出 =====
  const output = { commit, fixtureDir: FIXTURE_HOME, timestamp: new Date().toISOString(), model: 'zai/glm-5.3', allPassed: failedCount === 0, samples: results }
  writeFileSync(`${FIXTURE_HOME}/paired-results.json`, JSON.stringify(output, null, 2))
  console.log(`\n[sampling] done → ${FIXTURE_HOME}/paired-results.json (allPassed=${output.allPassed})`)
}

try {
  await main()
} catch (e) {
  console.error('[sampling] ERROR:', e.message)
  process.exitCode = 1
} finally {
  // 统一退出：SIGTERM + 有界等待
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    const exitDeadline = Date.now() + 5000
    while (child.exitCode === null && Date.now() < exitDeadline) {
      await new Promise(r => setTimeout(r, 200))
    }
    if (child.exitCode === null) {
      console.warn('[sampling] child did not exit in 5s, SIGKILL')
      child.kill('SIGKILL')
    }
  }
  console.log(`[sampling] harness exited (code=${child.exitCode})`)
}
