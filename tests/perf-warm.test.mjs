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
  const pendingPatches = new Map() // sessionId -> patch（会话创建前预置，创建时消费）
  const pendingNext = [] // 下一个创建的会话消费（服务端 sessionId 为随机值，请求前无法预知）
  const opts = { createDelayMs: 0, idleDelayMs: 0 }
  let createGate = null // { promise, resolve }：可选 create 门闸（精确控制 in-flight 时点）
  const create = async (base = {}) => {
    if (createGate) await createGate.promise
    if (opts.createDelayMs) await new Promise((r) => setTimeout(r, opts.createDelayMs))
    calls.creates += 1
    const sessionId = String(base.sessionId ?? `sess-${calls.creates}`)
    const rec = { followups: 0, slowMs: 0, throwOnce: false, throwFollowupOnce: false, throwIdleOnce: 0, idleGate: null, abortStyle: false }
    bySession.set(sessionId, rec)
    const patch = pendingPatches.get(sessionId) ?? pendingNext.shift()
    if (pendingPatches.has(sessionId)) pendingPatches.delete(sessionId)
    if (patch) { typeof patch === 'function' ? patch(rec) : Object.assign(rec, patch) }
    let seq = 0
    const events = []
    return {
      agent: {
        session: { get seq() { return seq }, events },
        whenIdle: async () => {
          if (rec.idleGate) await rec.idleGate.promise
          if (rec.throwIdleOnce > 0) { rec.throwIdleOnce -= 1; throw new Error('whenIdle exploded') }
          if (rec.slowMs || opts.idleDelayMs) await new Promise((r) => setTimeout(r, rec.slowMs || opts.idleDelayMs))
        },
        followup(msg) {
          calls.followups += 1
          rec.followups += 1
          if (rec.throwOnce) { rec.throwOnce = false; throw new Error('agent exploded') }
          if (rec.throwFollowupOnce) { rec.throwFollowupOnce = false; throw new Error('followup exploded') }
          const text = String(msg?.content?.[0]?.text ?? '')
          const reply = text.includes('bash') ? 'done' : 'OK'
          if (text.includes('#TOOLEV')) {
            events.push({ seq: seq++, type: 'tool/call', data: { callId: 'c1', name: 'bash' } })
            events.push({ seq: seq++, type: 'tool/result', data: { message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'tool-result', toolCallId: 'c1', content: 'COLD-TOOL-1\n', isError: false }] } } })
          }
          events.push({ seq: seq++, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: reply }] } } })
          // abortStyle：aborted stopReason + 部分文本（取消契约场景）
          events.push({ seq: seq++, type: 'turn/end', data: { reason: rec.abortStyle ? { kind: 'aborted' } : { kind: 'completed' } } })
        },
        cancel() {},
      },
      dispose: async () => { calls.disposes += 1 },
    }
  }
  return {
    create, resume: create, calls, bySession,
    control: (sessionId, patch) => {
      const rec = bySession.get(sessionId)
      if (rec) { typeof patch === 'function' ? patch(rec) : Object.assign(rec, patch) }
      else pendingPatches.set(sessionId, patch)
    },
    set createDelayMs(ms) { opts.createDelayMs = ms },
    set idleDelayMs(ms) { opts.idleDelayMs = ms },
    blockCreate: () => { let resolve; const promise = new Promise((r) => { resolve = r }); createGate = { promise, resolve }; return () => { createGate = null; resolve() } },
    patchNextCreate: (patch) => pendingNext.push(patch),
  }
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
  const disposePlugin = async () => { for (const d of disposers.splice(0).reverse()) { try { await d() } catch { /* best effort */ } } }
  const api = async (path, body) => {
    const r = await fetch(`${base}${path}?token=${HOST_TOKEN}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
    })
    return { status: r.status, body: await r.json().catch(() => ({})) }
  }
  return {
    api, agents, disposePlugin,
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

test('opening 阶段：并发预占上限 / create 等待中卸载 / 预热等待中卸载 / open 超时迟到恰释放一次', async () => {
  // ===== 并发 open：三个并发（create 延迟 180ms）→ 恰 2×200 + 1×409，creates=2 =====
  {
    const inst = await startInstance()
    try {
      inst.agents.createDelayMs = 180
      const rs = await Promise.all([inst.api('/__perf/warm/open', {}), inst.api('/__perf/warm/open', {}), inst.api('/__perf/warm/open', {})])
      const ok = rs.filter((r) => r.status === 200)
      const conflict = rs.filter((r) => r.status === 409)
      assert.equal(ok.length, 2, '并发 open：恰 2 个成功（预占配额生效）')
      assert.equal(conflict.length, 1, '并发 open：第 3 个 409')
      assert.equal(inst.agents.calls.creates, 2, '并发 open：恰创建 2 个会话（绕过上限已闭合）')
    } finally { await inst.close() }
  }
  // ===== create 等待中插件 dispose：迟到 handle 恰释放一次、不登记、503 =====
  {
    const inst = await startInstance()
    try {
      const release = inst.agents.blockCreate()
      const openPromise = inst.api('/__perf/warm/open', {})
      await new Promise((r) => setTimeout(r, 80)) // open 进入 create 等待
      await inst.disposePlugin() // 插件卸载（opening 通知 aborted）
      release() // 迟到的 create 完成
      const r = await openPromise
      assert.equal(r.status, 503, '卸载后 open 拒绝（503）')
      assert.equal(inst.agents.calls.creates, 1, 'create 恰发生一次')
      await new Promise((r2) => setTimeout(r2, 100))
      assert.equal(inst.agents.calls.disposes, 1, '迟到 handle 恰释放一次（不复活、不登记）')
      assert.equal((await inst.api('/__perf/warm/close', { handleId: r.body?.handleId ?? 'x' })).status, 404)
    } finally { await inst.close() }
  }
  // ===== 预热等待中卸载（create 已完成、whenIdle 慢）：同样 503 + 恰释放一次 =====
  {
    const inst = await startInstance()
    try {
      inst.agents.idleDelayMs = 400 // whenIdle 慢（create 后预热等待期）
      const openPromise = inst.api('/__perf/warm/open', {})
      await new Promise((r) => setTimeout(r, 120)) // create 已完成、预热在途
      await inst.disposePlugin()
      const r = await openPromise
      assert.equal(r.status, 503, '预热等待中卸载 → 503')
      await new Promise((r2) => setTimeout(r2, 500))
      assert.equal(inst.agents.calls.disposes, 1, '预热中的迟到 handle 恰释放一次')
    } finally { await inst.close() }
  }
  // ===== open 超时：不预热登记/不返回可用；迟到 create 恰释放一次；配额恢复 =====
  {
    const inst = await startInstance()
    try {
      const release = inst.agents.blockCreate()
      const openPromise = inst.api('/__perf/warm/open', { openTimeoutMs: 300 })
      const t0 = Date.now()
      const r = await openPromise
      assert.equal(r.status, 500, 'open 超时 → 500')
      assert.ok(Date.now() - t0 < 900, '在超时上限附近返回（非等 create）')
      release() // 迟到 create 完成
      await new Promise((r2) => setTimeout(r2, 150))
      assert.equal(inst.agents.calls.creates, 1)
      assert.equal(inst.agents.calls.disposes, 1, '迟到 handle 恰释放一次')
      // 配额恢复：随后两个 open 可成功
      inst.agents.createDelayMs = 0
      assert.equal((await inst.api('/__perf/warm/open', {})).status, 200, '配额恢复（1/2）')
      assert.equal((await inst.api('/__perf/warm/open', {})).status, 200, '配额恢复（2/2）')
      assert.equal((await inst.api('/__perf/warm/open', {})).status, 409, '上限仍生效')
    } finally { await inst.close() }
  }
})

test('opening 统一持有：work 异常清理 / 终止后不预热 / 永久 gate 不等待即释放 / 迟到不二次释放', async () => {
  // (a) followup 抛错（create 已成功）：500 + 已取得 handle 恰释放（此前 rejection 丢弃泄漏 disposes=0）
  {
    const inst = await startInstance()
    try {
      inst.agents.patchNextCreate({ throwFollowupOnce: true }) // 本次 open 的会话
      const r = await inst.api('/__perf/warm/open', {})
      assert.equal(r.status, 500, 'followup 异常 → 500')
      await new Promise((r2) => setTimeout(r2, 80))
      assert.equal(inst.agents.calls.creates, 1)
      assert.equal(inst.agents.calls.disposes, 1, '已取得 handle 必须释放（不再随 rejection 丢弃）')
    } finally { await inst.close() }
  }
  // (b) whenIdle 抛错（第二次，预热等待）：同样释放
  {
    const inst = await startInstance()
    try {
      inst.agents.patchNextCreate({ throwIdleOnce: 2 }) // 前两次 whenIdle 中第二次抛（预热等待处）
      const r = await inst.api('/__perf/warm/open', {})
      assert.equal(r.status, 500)
      await new Promise((r2) => setTimeout(r2, 80))
      assert.equal(inst.agents.calls.disposes, 1, 'whenIdle 异常：handle 释放')
    } finally { await inst.close() }
  }
  // (c) create 等待中卸载：503 + 迟到 create 清理，且终止后【零预热】
  {
    const inst = await startInstance()
    try {
      const release = inst.agents.blockCreate()
      const openPromise = inst.api('/__perf/warm/open', {})
      await new Promise((r) => setTimeout(r, 80))
      await inst.disposePlugin()
      const r = await openPromise // abortSignal 立即唤醒：不等 create
      assert.equal(r.status, 503, '卸载立即 503（不等 create）')
      release() // create 迟到完成
      await new Promise((r2) => setTimeout(r2, 150))
      assert.equal(inst.agents.calls.creates, 1)
      assert.equal(inst.agents.calls.followups, 0, '终止后不得预热（followups=0）')
      assert.equal(inst.agents.calls.disposes, 1, '迟到 create 恰释放一次')
    } finally { await inst.close() }
  }
  // (d) 预热永久 gate + 超时：无需等 gate 即释放已取得 handle；gate 放行后不二次释放
  {
    const inst = await startInstance()
    let releaseGate = null
    try {
      inst.agents.patchNextCreate((rec) => { let resolve; rec.idleGate = { promise: new Promise((r) => { resolve = r }) }; releaseGate = () => resolve() })
      const t0 = Date.now()
      const r = await inst.api('/__perf/warm/open', { openTimeoutMs: 300 })
      assert.equal(r.status, 500, '超时 → 500')
      assert.ok(Date.now() - t0 < 900, '不等永久 gate 即返回')
      assert.equal(inst.agents.calls.creates, 1, 'create 已取得 handle')
      await new Promise((r2) => setTimeout(r2, 120))
      assert.equal(inst.agents.calls.disposes, 1, 'gate 未放行也已释放（取消在途 whenIdle）')
      releaseGate?.() // 迟到放行
      await new Promise((r2) => setTimeout(r2, 120))
      assert.equal(inst.agents.calls.disposes, 1, '迟到不二次释放')
      assert.equal(inst.agents.calls.followups, 0, '首 whenIdle 永挂：未进入预热')
    } finally { releaseGate?.(); await inst.close() }
  }
  // (e) 预热永久 gate + 卸载：503 立即（不等 gate），handle 释放
  {
    const inst = await startInstance()
    let releaseGate = null
    try {
      inst.agents.patchNextCreate((rec) => { let resolve; rec.idleGate = { promise: new Promise((r) => { resolve = r }) }; releaseGate = () => resolve() })
      const openPromise = inst.api('/__perf/warm/open', {})
      await new Promise((r) => setTimeout(r, 100)) // create 完成，whenIdle 挂起中
      await inst.disposePlugin()
      const r = await openPromise
      assert.equal(r.status, 503, '卸载立即 503（不等 gate）')
      await new Promise((r2) => setTimeout(r2, 120))
      assert.equal(inst.agents.calls.disposes, 1, 'gate 未放行已释放')
    } finally { releaseGate?.(); await inst.close() }
  }
})

test('真实路由契约：stopReason 取消透传（部分文本非 ok）/ 实际模型参数 / chat marker 二重门控', async () => {
  const { default: plugin } = await import('../lib/index.mjs')
  const { mkdtemp, rm: rmDir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const bootInstance = async (testEndpoints, selection) => {
    const stateDir = await mkdtemp(join(tmpdir(), 'warmc-'))
    const agents = makeRecordingAgents()
    // 场景注入：followup 产生「部分文本 + aborted stopReason」
    agents.patchNextCreate({ abortStyle: true })
    const disposers = []
    const handlers = []
    const ctx = {
      effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
      on() { return () => {} },
      logger: { info() {}, warn() {}, error() {} },
      webServer: { register(route) { handlers.push(route); return () => {} } },
      agents,
      agentDefaultModel: { currentSelection: () => selection ?? null },
      llm: { listProviders: async () => [], listModels: async () => [] },
    }
    plugin.apply(ctx, { stateDir, testEndpoints })
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith(API_ROOT) || url.searchParams.get('token') !== HOST_TOKEN) { res.writeHead(401); res.end(); return }
      void handlers[0].handler(req, res)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}${API_ROOT}`
    const deadline = Date.now() + 8000
    for (;;) { try { if ((await fetch(`${base}/health?token=${HOST_TOKEN}`)).ok) break } catch {} if (Date.now() > deadline) throw new Error('就绪超时'); await new Promise((r) => setTimeout(r, 100)) }
    const api = async (path, body) => (await fetch(`${base}${path}?token=${HOST_TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })).json()
    return { api, agents, close: async () => { for (const d2 of disposers.splice(0).reverse()) { try { await d2() } catch {} }; try { server.closeAllConnections?.() } catch {}; await new Promise((r) => server.close(r)); await rmDir(stateDir, { recursive: true, force: true }).catch(() => undefined) } }
  }
  try {
    // 1) 冷直连与 warm open/turn：aborted + 部分文本 → cancelled（非 ok）
    const inst = await bootInstance(true, { provider: 't', model: 'm' })
    inst.agents.patchNextCreate({ abortStyle: true }) // 第二个会话 = warm open（其 turn 复用同 session）
    try {
      const d = await inst.api('/__perf/direct', { text: 'x' })
      assert.equal(d.status, 'cancelled', '冷直连：aborted+部分文本 → cancelled')
      assert.equal(d.cancelled, true)
      assert.ok(d.replyBytes > 0, '（场景构造）有部分文本')
      assert.equal(d.model, 't/m', '冷直连：实际模型参数透出（fallback selection）')
      const open = await inst.api('/__perf/warm/open', {})
      assert.equal(open.warmupStatus, 'cancelled', 'warm open：预热取消 → cancelled（停组依据）')
      assert.equal(open.model, 't/m', 'warm open：实际模型参数')
      const turn = await inst.api('/__perf/warm/turn', { handleId: open.handleId, text: 'y' })
      assert.equal(turn.status, 'cancelled', 'warm turn：取消透传')
      assert.equal(turn.cancelled, true)
      await inst.api('/__perf/warm/close', { handleId: open.handleId })
    } finally { await inst.close() }
    // 2) chat outcome：aborted stopReason → outcome.cancelled（部分文本非 ok）+ 模型透出
    const inst2 = await bootInstance(true, { provider: 't', model: 'm' })
    try {
      const chat = await inst2.api('/conversations/chief/chat', { text: 'x', requestId: 'cancel-probe-1' })
      assert.equal(chat.outcome.cancelled, true, 'chat：stopReason 取消 → outcome.cancelled')
      assert.ok(chat.reply && chat.reply.length > 0, '（场景构造）部分文本存在')
      assert.equal(chat.outcome.model, 't/m', 'chat outcome：实际模型参数（selection → session.model）')
    } finally { await inst2.close() }
    // 3) chat marker 二重门控：testEndpoints=false → 显式 evidenceMarker 不产生 evidence
    const inst3 = await bootInstance(false, null)
    try {
      const chat = await inst3.api('/conversations/chief/chat', { text: '#TOOLEV 用 bash', requestId: 'gate-probe-1', evidenceMarker: 'COLD-TOOL' })
      assert.ok(!('evidence' in (chat.outcome ?? {})), '默认关闭：显式 marker 请求也不返回 evidence（二重门控）')
    } finally { await inst3.close() }
    // 4) 对照：testEndpoints=true → evidence 存在（同请求）
    const inst4 = await bootInstance(true, null)
    try {
      inst4.agents.patchNextCreate({ abortStyle: false })
      const chat = await inst4.api('/conversations/chief/chat', { text: '#TOOLEV 用 bash', requestId: 'gate-probe-2', evidenceMarker: 'COLD-TOOL' })
      assert.ok('evidence' in (chat.outcome ?? {}), '测试模式：evidence 返回（对照）')
    } finally { await inst4.close() }
  } finally { /* instances self-closed */ }
})
