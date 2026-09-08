// 预览 POST 边界 + 测试端点门控——真实路由集成回归
// 驱动真实构建产物 lib/index.mjs（apply → webServer.register → handler），
// mock agents（不真实模型），外层包一个「仿真宿主 token 层」（仅测试内模拟宿主授权，
// 不改插件本体认证语义）。覆盖：
//  1) 默认关闭：__probe/*、__perf/direct 404，不创建会话（agents.create 计数 0），不写计数
//  2) 显式开启（config.testEndpoints:true）：echo/count 可用 + Origin 边界
//     （同源 200 / opaque "null" 403 / 跨源 403 / 无 Origin 非浏览器客户端 200）
//  3) 成果预览路由：html → CSP sandbox + nosniff；?download=1 → attachment；
//     未知 id 404；POST 无 action 405
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const API_ROOT = '/api/plugins/grokbot'
const HOST_TOKEN = 'harness-host-token' // 仿真宿主层的 token（等价线上 ?token=…）

async function startInstance({ testEndpoints = false } = {}) {
  const { default: plugin } = await import('../lib/index.mjs')
  assert.equal(process.env.GROKBOT_TEST_ENDPOINTS ?? '', '', '测试进程不得携带 GROKBOT_TEST_ENDPOINTS（默认关闭场景会被污染）')
  const stateDir = await mkdtemp(join(tmpdir(), 'ppb-'))
  const workspace = join(stateDir, 'workspace')
  await mkdir(workspace, { recursive: true })
  const disposers = []
  const handlers = []
  let agentsCreateCalls = 0
  const ctx = {
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    on() { return () => {} },
    logger: { info() {}, warn() {}, error() {} },
    webServer: { register(route) { handlers.push(route); return () => {} } },
    agents: {
      create: async () => {
        agentsCreateCalls += 1
        return {
          agent: {
            session: { seq: 0, events: [] },
            whenIdle: async () => {},
            followup() {},
            cancel() {},
          },
          dispose: async () => {},
        }
      },
      resume: async (base) => ctx.agents.create(base),
    },
    agentDefaultModel: { currentSelection: () => null },
    llm: { listProviders: async () => [], listModels: async () => [] },
  }
  plugin.apply(ctx, { stateDir, testEndpoints })
  assert.equal(handlers.length, 1, '注册且仅注册一个 prefix handler')

  // 仿真宿主授权层：/api/plugins/* 需 token（query 或 bearer）——测试模拟，不放宽不替代插件认证
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (!url.pathname.startsWith(API_ROOT)) { res.writeHead(404); res.end(); return }
    const token = url.searchParams.get('token') ?? /(?:^|\s)Bearer\s+(\S+)/.exec(String(req.headers?.authorization ?? ''))?.[1]
    if (token !== HOST_TOKEN) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized (harness host layer)' })); return }
    void handlers[0].handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${API_ROOT}`

  // 就绪等待（apply 的 init 异步完成）
  const deadline = Date.now() + 8000
  for (;;) {
    try {
      const r = await fetch(`${base}/health?token=${HOST_TOKEN}`)
      if (r.ok) break
    } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error('插件实例就绪超时')
    await new Promise((r) => setTimeout(r, 100))
  }

  return {
    base,
    stateDir,
    workspace,
    agentsCreateCalls: () => agentsCreateCalls,
    seedArtifact: async (name, content) => {
      const sourceReal = join(workspace, name)
      await writeFile(sourceReal, content, 'utf8')
      const { createArtifactSnapshot } = await import('../src/delivery-core.mjs')
      const { meta } = await createArtifactSnapshot({ artifactsRoot: join(stateDir, 'artifacts'), sourceReal, workspaceRoot: workspace })
      return meta
    },
    close: async () => {
      for (const d of disposers.splice(0).reverse()) { try { await d() } catch { /* best effort */ } }
      await new Promise((resolve) => server.close(resolve))
      await rm(stateDir, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}

test('默认关闭：测试端点 404、不创建会话、预览路由正常', async () => {
  const inst = await startInstance()
  try {
    const echo = await fetch(`${inst.base}/__probe/echo?token=${HOST_TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(inst.base).origin },
      body: '{}',
    })
    assert.equal(echo.status, 404, '__probe/echo 默认不可达（接口不存在）')

    const count = await fetch(`${inst.base}/__probe/count?token=${HOST_TOKEN}`)
    assert.equal(count.status, 404, '__probe/count 默认不可达')

    const direct = await fetch(`${inst.base}/__perf/direct?token=${HOST_TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'baseline' }),
    })
    assert.equal(direct.status, 404, '__perf/direct 默认不可达')
    assert.equal(inst.agentsCreateCalls(), 0, '默认关闭不得创建任何 agents 会话')
  } finally { await inst.close() }
})

test('显式开启（config.testEndpoints）：echo/count 可用 + Origin 边界', async () => {
  const inst = await startInstance({ testEndpoints: true })
  try {
    const origin = new URL(inst.base).origin
    const c0 = await (await fetch(`${inst.base}/__probe/count?token=${HOST_TOKEN}`)).json()
    assert.equal(c0.count, 0)

    const ok = await fetch(`${inst.base}/__probe/echo?token=${HOST_TOKEN}`, {
      method: 'POST', headers: { origin }, body: '{}',
    })
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).count, 1, '同源 POST 计数 +1')

    // 预览沙箱（CSP sandbox 无 allow-same-origin）脚本请求 Origin 为字面量 "null" → 403
    const opaque = await fetch(`${inst.base}/__probe/echo?token=${HOST_TOKEN}`, {
      method: 'POST', headers: { origin: 'null' }, body: '{}',
    })
    assert.equal(opaque.status, 403, 'opaque origin（"null"）POST 必须被拒——预览脚本借 token 也无效')

    const cross = await fetch(`${inst.base}/__probe/echo?token=${HOST_TOKEN}`, {
      method: 'POST', headers: { origin: 'http://evil.example' }, body: '{}',
    })
    assert.equal(cross.status, 403, '跨源 POST 被拒')

    const noOrigin = await fetch(`${inst.base}/__probe/echo?token=${HOST_TOKEN}`, {
      method: 'POST', body: '{}',
    })
    assert.equal(noOrigin.status, 200, '无 Origin（非浏览器客户端）语义不变')
    assert.equal((await noOrigin.json()).count, 2)

    const c1 = await (await fetch(`${inst.base}/__probe/count?token=${HOST_TOKEN}`)).json()
    assert.equal(c1.count, 2, '被拒请求不写计数（401/403 均未计数）')

    // __perf/direct（mock agent，不真实模型）：开启后可用且恰好创建 1 个会话
    const direct = await fetch(`${inst.base}/__perf/direct?token=${HOST_TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'baseline' }),
    })
    assert.equal(direct.status, 200)
    assert.equal(inst.agentsCreateCalls(), 1, '__perf/direct 恰好创建 1 个（mock）会话')
  } finally { await inst.close() }
})

test('成果预览路由：CSP sandbox 响应头 + 保存副本 + 边界状态码', async () => {
  const inst = await startInstance()
  try {
    const body = '<!doctype html><html><body><h1>PREVIEW_OK</h1></body></html>'
    const meta = await inst.seedArtifact('probe.html', body)

    const preview = await fetch(`${inst.base}/artifacts/${meta.id}?token=${HOST_TOKEN}`)
    assert.equal(preview.status, 200)
    assert.equal(await preview.text(), body)
    assert.equal(preview.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(preview.headers.get('content-security-policy'), 'sandbox allow-scripts allow-popups allow-forms')
    assert.equal(preview.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(preview.headers.get('x-artifact-sha256'), createHash('sha256').update(body).digest('hex'))

    const save = await fetch(`${inst.base}/artifacts/${meta.id}?token=${HOST_TOKEN}&download=1`)
    assert.equal(save.status, 200)
    assert.match(save.headers.get('content-disposition') ?? '', /^attachment; filename\*=UTF-8''probe\.html$/)

    const missing = await fetch(`${inst.base}/artifacts/art-not-exist?token=${HOST_TOKEN}`)
    assert.equal(missing.status, 404)

    const badMethod = await fetch(`${inst.base}/artifacts/${meta.id}?token=${HOST_TOKEN}`, { method: 'POST' })
    assert.equal(badMethod.status, 405)
  } finally { await inst.close() }
})

test('无 token：仿真宿主层 401（预览脚本无授权即被宿主层拦下）', async () => {
  const inst = await startInstance({ testEndpoints: true })
  try {
    const r = await fetch(`${inst.base}/__probe/echo`, { method: 'POST', headers: { origin: 'null' }, body: '{}' })
    assert.equal(r.status, 401)
    const c = await fetch(`${inst.base}/__probe/count?token=${HOST_TOKEN}`).then((x) => x.json())
    assert.equal(c.count, 0, '无 token 请求未写计数')
  } finally { await inst.close() }
})
