#!/usr/bin/env node
// 预览 POST 边界 fixture——独立验证（本机、可随时退出；不碰用户安装，不真实模型）
//
// 用途：
//   1. 启动真实构建产物（lib/index.mjs）+ mock agents，testEndpoints 显式开启
//   2. 注入一个探针 HTML 成果（经真实 createArtifactSnapshot 落盘），其脚本在
//      CSP sandbox（opaque origin）内尝试 fetch/form POST 到 __probe/echo：
//      a1 fetch 无 token / a2 fetch 带 token / a3 fetch no-cors 带 token /
//      a4 form 无 token / a5 form 带 token（target=隐藏 iframe，避免导航走结果页）
//   3. 记录服务端视角的每个请求（method/path/origin/状态码）与计数器前后——
//      「不能仅 Failed to fetch 当无写入」：以服务端日志为准
//
// 用法：
//   node tests/preview-post-fixture/run.mjs            # 自检模式：启动→node侧自验→打印证据→退出
//   node tests/preview-post-fixture/run.mjs --serve    # 浏览器验证模式：常驻，打印预览 URL，SIGINT 退出
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import assert from 'node:assert/strict'

const API_ROOT = '/api/plugins/grokbot'
const HOST_TOKEN = 'fixture-host-token' // 仿真宿主授权层 token（模拟线上 ?token=…，不改插件认证）
const SERVE = process.argv.includes('--serve')

const { default: plugin } = await import('../../lib/index.mjs')
assertCleanEnv()

const stateDir = await mkdtemp(join(tmpdir(), 'ppv-'))
const workspace = join(stateDir, 'workspace')
await mkdir(workspace, { recursive: true })
const disposers = []
const handlers = []
let agentsCreateCalls = 0
const requestLog = [] // 服务端视角证据：__probe/* 与 artifacts/* 的每个请求

const ctx = {
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
  on() { return () => {} },
  logger: { info() {}, warn() {}, error() {} },
  webServer: { register(route) { handlers.push(route); return () => {} } },
  agents: {
    create: async () => {
      agentsCreateCalls += 1
      return { agent: { session: { seq: 0, events: [] }, whenIdle: async () => {}, followup() {}, cancel() {} }, dispose: async () => {} }
    },
    resume: async (base) => ctx.agents.create(base),
  },
  agentDefaultModel: { currentSelection: () => null },
  llm: { listProviders: async () => [], listModels: async () => [] },
}
plugin.apply(ctx, { stateDir, testEndpoints: true }) // 显式开启测试端点（本 fixture 的唯一目的）
assert.equal(handlers.length, 1)

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (!url.pathname.startsWith(API_ROOT)) { res.writeHead(404); res.end(); return }
  const token = url.searchParams.get('token')
  if (token !== HOST_TOKEN) { logRequest(req, url, 401, res); res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized (fixture host layer)' })); return }
  res.on('finish', () => logRequest(req, url, res.statusCode, res))
  void handlers[0].handler(req, res)
})
function logRequest(req, url, status, res) {
  const p = url.pathname.slice(API_ROOT.length)
  if (!(p.startsWith('/__probe') || p.startsWith('/__perf') || p.startsWith('/artifacts'))) return
  const entry = { method: req.method, path: p + (url.searchParams.get('download') === '1' ? '?download=1' : ''), origin: req.headers?.origin ?? null, token: url.searchParams.has('token'), status }
  const cd = res?.getHeader?.('content-disposition')
  if (cd) entry.contentDisposition = String(cd)
  requestLog.push(entry)
  process.stdout.write(`[req] ${req.method} ${p} origin=${JSON.stringify(req.headers?.origin ?? null)} token=${url.searchParams.has('token')} → ${status}${cd ? ` (${cd})` : ''}\n`)
}
await new Promise((resolve) => server.listen(SERVE ? 8791 : 0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}${API_ROOT}`

await waitHealthy()

// ---- 注入探针成果（真实快照路径：workspace → artifacts/<id>/data/payload + meta.json）----
const probeHtml = buildProbePage(base)
const meta = await seed('probe-preview.html', probeHtml)
const previewUrl = `${base}/artifacts/${meta.id}?token=${HOST_TOKEN}`

async function getCount() {
  const r = await fetch(`${base}/__probe/count?token=${HOST_TOKEN}`)
  return (await r.json()).count
}
const countBefore = await getCount()

console.log(JSON.stringify({ event: 'ready', base, previewUrl, artifactId: meta.id, countBefore, agentsCreateCalls }))

// 有界收尾：浏览器 keep-alive 连接会卡住 server.close 回调——先 closeAllConnections，
// 再给 2s 兜底强退；自有临时目录清理放 finally，任何路径都不遗留
async function teardown(exitCode) {
  try {
    for (const d of disposers.reverse()) { try { await d() } catch {} }
  } finally {
    try { server.closeAllConnections?.() } catch { /* Node <18.2 无此 API */ }
    await Promise.race([
      new Promise((r) => server.close(() => r())),
      new Promise((r) => setTimeout(r, 2000)),
    ])
    await rm(stateDir, { recursive: true, force: true }).catch(() => undefined)
    process.exit(exitCode)
  }
}

if (SERVE) {
  // 浏览器验证模式：等 SIGINT，退出时打印证据汇总
  let closing = false
  const shutdown = async () => {
    if (closing) return
    closing = true
    const countAfter = await getCount().catch(() => -1)
    console.log(JSON.stringify({ event: 'evidence', countBefore, countAfter, counterChanged: countAfter !== countBefore, agentsCreateCalls, requests: requestLog }, null, 1))
    await teardown(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
} else {
  // 自检模式：node 侧验证预览/保存响应头与 echo 可用，然后退出
  const pv = await fetch(previewUrl)
  const dl = await fetch(`${previewUrl}&download=1`)
  const csp = pv.headers.get('content-security-policy')
  const disposition = dl.headers.get('content-disposition')
  const okPreview = pv.status === 200 && (await pv.text()) === probeHtml && csp === 'sandbox allow-scripts allow-popups allow-forms'
  const okSave = dl.status === 200 && /^attachment;/.test(disposition ?? '')
  const countAfter = await getCount()
  console.log(JSON.stringify({ event: 'selfcheck', okPreview, csp, okSave, disposition, countBefore, countAfter, agentsCreateCalls, requests: requestLog }, null, 1))
  await teardown(okPreview && okSave ? 0 : 1)
}

async function waitHealthy() {
  const deadline = Date.now() + 8000
  for (;;) {
    try { if ((await fetch(`${base}/health?token=${HOST_TOKEN}`)).ok) return } catch {}
    if (Date.now() > deadline) throw new Error('fixture 就绪超时')
    await new Promise((r) => setTimeout(r, 100))
  }
}
async function seed(name, content) {
  const sourceReal = join(workspace, name)
  await writeFile(sourceReal, content, 'utf8')
  const { createArtifactSnapshot } = await import('../../src/delivery-core.mjs')
  const { meta: m } = await createArtifactSnapshot({ artifactsRoot: join(stateDir, 'artifacts'), sourceReal, workspaceRoot: workspace })
  return m
}
function assertCleanEnv() {
  if (process.env.GROKBOT_TEST_ENDPOINTS) throw new Error('fixture 依赖 config.testEndpoints 显式开启，不得用环境变量')
}

// 探针页：opaque origin（CSP sandbox）内尝试借宿主授权 POST——结果写入 DOM，供浏览器读取
function buildProbePage(b) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>preview-post-probe</title></head>
<body>
<h1>PREVIEW_OK</h1>
<!-- 两个独立 sink：共享同一 iframe 时，第二次 submit 会取消第一次尚未派发的导航（无 token form 丢失） -->
<iframe name="sinkNoToken" id="sinkNoToken" style="display:none"></iframe>
<iframe name="sinkToken" id="sinkToken" style="display:none"></iframe>
<ul id="results"></ul>
<a id="save" href="#">保存副本</a>
<script>
var B = ${JSON.stringify(b)}, T = ${JSON.stringify(HOST_TOKEN)}
// 保存副本：指向自身 URL + download=1（页面无法预知自己的 artifact id，运行时取 location）
document.getElementById('save').href = location.href + (location.search ? '&' : '?') + 'download=1'
function mark(name, outcome) {
  var li = document.createElement('li')
  li.id = 'r-' + name
  li.textContent = name + ': ' + outcome
  document.getElementById('results').appendChild(li)
  if (document.querySelectorAll('#results li').length >= 6) {
    var d = document.createElement('div'); d.id = 'done'; d.textContent = 'ALL_ATTEMPTS_DONE'
    document.body.appendChild(d)
  }
}
function attempt(name, url, opts) {
  return fetch(url, opts).then(function (r) { mark(name, 'status ' + r.status) }, function (e) { mark(name, String(e)) })
}
attempt('fetch-noToken', B + '/__probe/echo', { method: 'POST', body: '{}' })
attempt('fetch-token-cors', B + '/__probe/echo?token=' + T, { method: 'POST', body: '{}' })
attempt('fetch-token-noCors', B + '/__probe/echo?token=' + T, { method: 'POST', mode: 'no-cors', body: '{}' })
attempt('fetch-count-token', B + '/__probe/count?token=' + T, {})
function formAttempt(name, withToken) {
  var f = document.createElement('form')
  // 独立 sink：无 token / 带 token 各走自己的 iframe，第二次 submit 不再取消第一次
  f.method = 'POST'; f.target = withToken ? 'sinkToken' : 'sinkNoToken'
  f.action = B + '/__probe/echo' + (withToken ? '?token=' + T : '')
  document.body.appendChild(f)
  f.submit()
  setTimeout(function () { mark(name, 'submitted') }, 60)
}
setTimeout(function () { formAttempt('form-noToken', false) }, 100)
setTimeout(function () { formAttempt('form-token', true) }, 400)
</script>
</body></html>`.replace('ARTIFACT_ID', '__ARTIFACT_ID__')
}
