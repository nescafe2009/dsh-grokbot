// 效率配对采样：独立 DSH_HOME + 交替顺序 + 认证预检
// 用法：ZAI_API_KEY=<key> node sample.mjs
// 退出：自动（采样完成 or 预检失败 exit 1）
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const PORT = 27995 + Math.floor(Math.random() * 100)
const DSH_BIN = '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js'
const FIXTURE_HOME = '/tmp/dsh-perf-fixture'

// ===== 认证预检 =====
if (!process.env.ZAI_API_KEY) {
  console.error('[preflight] FAIL: ZAI_API_KEY not set. Export it before running.')
  console.error('[preflight] SDK resolves it via launchEnvironmentOf(ctx).get("ZAI_API_KEY") (dsh-llm-pi-ai/lib/index.js:2474)')
  process.exit(1)
}
console.log('[preflight] ZAI_API_KEY is set (value not logged)')

// ===== 版本记录 =====
let commit = 'unknown'
try { commit = execSync('git rev-parse HEAD', { cwd: '/Users/moltbot/Documents/Workspaces/Zcode/DshCustomize' }).toString().trim().slice(0, 12) } catch {}
console.log(`[sampling] commit=${commit} port=${PORT}`)

// ===== 启动独立 harness =====
const child = spawn('node', [DSH_BIN, '--profile','web','--port',String(PORT),'--host','127.0.0.1','--no-open'], {
  env: { ...process.env, DSH_HOME: FIXTURE_HOME },
  stdio: ['ignore','pipe','pipe'],
})
let token = ''
await new Promise((ok, bad) => {
  const t = setTimeout(() => bad(new Error('harness start timeout')), 25000)
  child.stdout.on('data', d => { const m = d.toString().match(/token=([^\s]+)/); if (m) { token = m[1]; clearTimeout(t); ok() } })
  child.on('exit', c => { clearTimeout(t); bad(new Error(`harness exited ${c}`)) })
})
console.log('[sampling] harness ready')

const B = `http://127.0.0.1:${PORT}/api/plugins/grokbot`
const H = { 'content-type': 'application/json' }
const samples = []

async function api(path, body, ms = 120000) {
  const t0 = Date.now()
  try {
    const r = await fetch(`${B}${path}?token=${token}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
    const j = await r.json()
    return { ms: Date.now() - t0, http: r.status, ...j }
  } catch (e) { return { ms: Date.now() - t0, error: e.message } }
}
async function mkBot(name) {
  const r = await fetch(`${B}/bots?token=${token}`, { method: 'POST', headers: H, body: JSON.stringify({ name, title: '采样' }) })
  return (await r.json()).bot?.id
}
async function rmBot(id) { await fetch(`${B}/bots/${id}?token=${token}`, { method: 'DELETE' }).catch(() => {}) }

// ===== 认证预检（真实调用） =====
const preflight = await api('/__perf/direct', { text: '预检：只回复 OK。' })
if (preflight.status !== 'ok') {
  console.error(`[preflight] FAIL: model call status=${preflight.status} error=${preflight.error}`)
  child.kill('SIGTERM')
  await new Promise(r => child.on('exit', r))
  process.exit(1)
}
console.log(`[preflight] model call OK (${preflight.ms}ms)`)

const QA = '配对冷A：只回复 OK。'
const TOOL = '配对冷B：用 bash 执行 echo COLD-TOOL 并回复输出。'

// ===== 冷↔冷 问答 ×4（交替） =====
console.log('\n== 冷↔冷 问答 ==')
for (let i = 1; i <= 4; i++) {
  const d = await api('/__perf/direct', { text: QA })
  samples.push({ round: i, pair: 'cold-qa', side: 'direct', ...d })
  console.log(`  ${i}D: ${d.ms}ms status=${d.status} tools=${d.toolCalls}`)
  const bid = await mkBot(`冷${i}`)
  const p = await api(`/conversations/${bid}/chat`, { text: QA })
  samples.push({ round: i, pair: 'cold-qa', side: 'plugin', botId: bid, reply: (p.reply||'').slice(0,20), ...p })
  console.log(`  ${i}P: ${p.ms}ms status=${p.reply ? 'ok' : 'failed'}`)
  await rmBot(bid)
}

// ===== 冷↔冷 工具 ×2（交替） =====
console.log('\n== 冷↔冷 工具 ==')
for (let i = 1; i <= 2; i++) {
  const d = await api('/__perf/direct', { text: TOOL })
  samples.push({ round: i, pair: 'cold-tool', side: 'direct', ...d })
  console.log(`  ${i}D: ${d.ms}ms tools=${d.toolCalls}`)
  const bid = await mkBot(`工具${i}`)
  const p = await api(`/conversations/${bid}/chat`, { text: TOOL })
  samples.push({ round: i, pair: 'cold-tool', side: 'plugin', botId: bid, reply: (p.reply||'').slice(0,30), ...p })
  console.log(`  ${i}P: ${p.ms}ms`)
  await rmBot(bid)
}

// ===== 暖插件 ×5（独立验收 bot 连续同 session） =====
console.log('\n== 暖插件 ==')
const warmBot = await mkBot('暖采样')
for (let i = 1; i <= 5; i++) {
  const p = await api(`/conversations/${warmBot}/chat`, { text: `配对暖${i}：只回复 OK。` })
  samples.push({ round: i, pair: 'warm-plugin', side: 'plugin', botId: warmBot, reply: (p.reply||'').slice(0,20), ...p })
  console.log(`  ${i}: ${p.ms}ms`)
}
await rmBot(warmBot)

// ===== 输出 =====
writeFileSync('/tmp/perf-paired-results.json', JSON.stringify({
  commit, timestamp: new Date().toISOString(), model: 'zai/glm-5.3', samples
}, null, 2))
console.log('\n[sampling] done → /tmp/perf-paired-results.json')

child.kill('SIGTERM')
await new Promise(r => child.on('exit', r))
console.log('[sampling] harness exited')
