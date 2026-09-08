// 暖直连专用生命周期回归——真实路由（lib/index.mjs __perf/warm/*）+ 记录型 mock agents。
// 覆盖：成功路径（open→turn×N→close，同 session 串行）/ 会话隔离 / 忙 409 / 活跃上限 /
// TTL 过期释放 / 未知与已关零创建 / turn 异常释放 / 单轮超时释放 / evidence 最小字段 /
// 默认关闭 404 / 冷直连一次创建释放语义保留 / 插件 dispose 释放。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const API_ROOT = '/api/plugins/grokbot'
const HOST_TOKEN = 'warm-harness-token'

function makeRecordingAgents() {
  const calls = { creates: 0, disposes: 0, followups: 0 }
  const bySession = new Map() // sessionId -> { followups, slowMs, throwOnce }
  const create = async (base = {}) => {
    calls.creates += 1
    const sessionId = String(base.sessionId ?? `sess-${calls.creates}`)
    const rec = { followups: 0, slowMs: 0, throwOnce: false }
    bySession.set(sessionId, rec)
    let seq = 0
    const events = []
    let busyGate = Promise.resolve()
    return {
      agent: {
        session: { get seq() { return seq }, events },
        whenIdle: async () => { if (rec.slowMs) await new Promise((r) => setTimeout(r, rec.slowMs)) },
        followup(msg) {
          calls.followups += 1
          rec.followups += 1
          if (rec.throwOnce) { rec.throwOnce = false; throw new Error('agent exploded') }
          const text = String(msg?.content?.[0]?.text ?? '')
          const reply = text.includes('bash') ? 'done' : 'OK'
          if (text.includes('#TOOLEV')) {
            events.push({ seq: seq++, type: 'tool/call', data: { callId: 'c1', name: 'bash' } })
            events.push({ seq: seq++, type: 'tool/result', data: { message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'tool-result', toolCallId: 'c1', content: 'COLD-TOOL-1\n', isError: false }] } } })
          }
          events.push({ seq: seq++, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: reply }] } } })
          events.push({ seq: seq++, type: 'turn/end', data: { reason: { kind: 'completed' } } })
        },
        cancel() {},
      },
      dispose: async () => { calls.disposes += 1 },
    }
  }
  return { create, resume: create, calls, bySession, control: (sessionId, patch) => Object.assign(bySession.get(sessionId) ?? {}, patch) }
}

async function startInstance({ testEndpoints = true } = {}) {
  const { default: plugin } = await import('../lib/index.mjs')
  const stateDir = await mkdtemp(join(tmpdir(), 'warm-'))
  const agents = makeRecordingAgents()
  const disposers = []
  const handlers = []
  const ctx = {
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    on() { return () => {} },
    logger: { info() {}, warn() {}, error() {} },
    webServer: { register(route) { handlers.push(route); return () => {} } },
    agents,
    agentDefaultModel: { currentSelection: () => null },
    llm: { listProviders: async () => [], listModels: async () => [] },
  }
  plugin.apply(ctx, { stateDir, testEndpoints })
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (!url.pathname.startsWith(API_ROOT) || url.searchParams.get('token') !== HOST_TOKEN) {
      res.writeHead(url.pathname.startsWith(API_ROOT) ? 401 : 404); res.end(); return
    }
    void handlers[0].handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${API_ROOT}`
  const deadline = Date.now() + 8000
  for (;;) {
    try { if ((await fetch(`${base}/health?token=${HOST_TOKEN}`)).ok) break } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error('就绪超时')
    await new Promise((r) => setTimeout(r, 100))
  }
  const api = async (path, body) => {
    const r = await fetch(`${base}${path}?token=${HOST_TOKEN}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
    })
    return { status: r.status, body: await r.json().catch(() => ({})) }
  }
  return {
    api, agents,
    close: async () => {
      for (const d of disposers.splice(0).reverse()) { try { await d() } catch { /* best effort */ } }
      try { server.closeAllConnections?.() } catch {}
      await new Promise((resolve) => server.close(resolve))
      await rm(stateDir, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}

test('暖直连生命周期：成功路径/隔离/忙/上限/TTL/零创建/异常释放/超时释放/默认关闭', async () => {
  const inst = await startInstance()
  try {
    // ===== 成功路径：open（预热1）→ turn×3（同 session 串行）→ close =====
    const before = { c: inst.agents.calls.creates, d: inst.agents.calls.disposes, f: inst.agents.calls.followups }
    const open = await inst.api('/__perf/warm/open', {})
    assert.equal(open.status, 200)
    assert.ok(open.body.handleId && open.body.sessionId, '返回随机 handleId 与服务端自建 sessionId')
    assert.equal(open.body.warmupStatus, 'ok')
    assert.equal(inst.agents.calls.creates - before.c, 1, 'open 恰创建 1 个会话')
    assert.equal(inst.agents.calls.followups - before.f, 1, '预热恰一次 followup')
    const sid = open.body.sessionId

    const t1 = await inst.api('/__perf/warm/turn', { handleId: open.body.handleId, text: '第一轮' })
    assert.equal(t1.status, 200)
    assert.equal(t1.body.warm, true)
    assert.equal(t1.body.turn, 1)
    assert.equal(t1.body.sessionId, sid, '同一 session')
    const t2 = await inst.api('/__perf/warm/turn', { handleId: open.body.handleId, text: '#TOOLEV 用 bash', evidenceMarker: 'COLD-TOOL' })
    assert.equal(t2.body.turn, 2)
    assert.deepEqual(t2.body.evidence, { shellOk: true, targetMatch: true }, 'evidence 最小字段（布尔）')
    assert.ok(!('toolResults' in t2.body), '不附原始工具文本')
    const close = await inst.api('/__perf/warm/close', { handleId: open.body.handleId })
    assert.equal(close.status, 200)
    assert.equal(inst.agents.calls.disposes - before.d, 1, 'close 恰释放 1 次')
    // 已关 handle：turn/close 均 404 且零创建
    assert.equal((await inst.api('/__perf/warm/turn', { handleId: open.body.handleId, text: 'x' })).status, 404)
    assert.equal((await inst.api('/__perf/warm/close', { handleId: open.body.handleId })).status, 404)
    assert.equal(inst.agents.calls.creates - before.c, 1, '未知/已关 handle 零会话创建')

    // ===== 会话隔离：两个 handle 独立 session；活跃上限 2 → 第三个 409 =====
    const o1 = await inst.api('/__perf/warm/open', {})
    const o2 = await inst.api('/__perf/warm/open', {})
    assert.notEqual(o1.body.sessionId, o2.body.sessionId, '两个 handle 会话隔离')
    assert.equal((await inst.api('/__perf/warm/open', {})).status, 409, '活跃上限 2 → 第三个 409')
    await inst.api('/__perf/warm/close', { handleId: o1.body.handleId })
    assert.equal((await inst.api('/__perf/warm/open', {})).status, 200, '释放后可再开')

    // ===== 忙=409 串行（在途轮次期间并发第二个） =====
    inst.agents.control(o2.body.sessionId, { slowMs: 250 })
    const inFlight = inst.api('/__perf/warm/turn', { handleId: o2.body.handleId, text: '慢轮' })
    await new Promise((r) => setTimeout(r, 60))
    const busy = await inst.api('/__perf/warm/turn', { handleId: o2.body.handleId, text: '并发轮' })
    assert.equal(busy.status, 409, '忙=409（串行明确）')
    assert.equal((await inFlight).status, 200)
    inst.agents.control(o2.body.sessionId, { slowMs: 0 })

    // ===== turn 异常释放：followup 抛错 → 500 + handle 移除（close 变 404） =====
    inst.agents.control(o2.body.sessionId, { throwOnce: true })
    const boom = await inst.api('/__perf/warm/turn', { handleId: o2.body.handleId, text: '引爆' })
    assert.equal(boom.status, 500)
    assert.equal((await inst.api('/__perf/warm/close', { handleId: o2.body.handleId })).status, 404, '异常后 handle 已释放')

    // ===== 单轮超时释放 =====
    const o3 = await inst.api('/__perf/warm/open', {})
    inst.agents.control(o3.body.sessionId, { slowMs: 900 })
    const slow = await inst.api('/__perf/warm/turn', { handleId: o3.body.handleId, text: '超慢', turnTimeoutMs: 300 })
    assert.equal(slow.status, 500, '单轮超时 → 500')
    assert.equal((await inst.api('/__perf/warm/close', { handleId: o3.body.handleId })).status, 404, '超时后 handle 已释放')

    // ===== TTL 过期释放 =====
    const o4 = await inst.api('/__perf/warm/open', { ttlMs: 1000 })
    assert.equal(o4.status, 200)
    await new Promise((r) => setTimeout(r, 1300))
    assert.equal((await inst.api('/__perf/warm/turn', { handleId: o4.body.handleId, text: '过期后' })).status, 410, 'TTL 过期 → 410')

    // ===== 插件 dispose 释放全部活跃 handle =====
    const o5 = await inst.api('/__perf/warm/open', {})
    const dBefore = inst.agents.calls.disposes
    await inst.close()
    await new Promise((r) => setTimeout(r, 100))
    assert.ok(inst.agents.calls.disposes >= dBefore + 1, '插件 dispose 释放活跃 handle')
    return
  } finally {
    await inst.close()
  }
})

test('默认关闭：warm/* 路由 404 且零会话创建；冷直连一次创建释放语义保留', async () => {
  const off = await startInstance({ testEndpoints: false })
  try {
    assert.equal((await off.api('/__perf/warm/open', {})).status, 404, '默认关闭：open 404')
    assert.equal(off.agents.calls.creates, 0)
  } finally { await off.close() }
  const on = await startInstance({ testEndpoints: true })
  try {
    const d = await on.api('/__perf/direct', { text: '冷直连一次' })
    assert.equal(d.status, 200)
    assert.equal(on.agents.calls.creates, 1, '冷直连：一次创建')
    assert.equal(on.agents.calls.disposes, 1, '冷直连：一次释放（语义保留）')
    assert.equal((await on.api('/__perf/warm/turn', { handleId: 'unknown-handle', text: 'x' })).status, 404)
    assert.equal(on.agents.calls.creates, 1, '未知 handle 零创建')
  } finally { await on.close() }
})
