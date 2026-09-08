// 采样契约回归——mock 依赖驱动【真实编排】（perf-fixture/orchestrate.mjs，非路由测试、不复制表达式）。
// 覆盖：成功全链（模型匹配/时间字段/顺序/marker 门控）/ 模型不匹配 / 模型未知 / 取消带部分文本非 ok /
// warm-plugin 预热失败停组并释放 / warm-direct 预热失败跳过 turns 且 close 仍执行 / close 失败 incomplete 非零。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runSampling, normalizeSample, pairModelMatch, MARKER } from '../perf-fixture/orchestrate.mjs'

// mock 依赖工厂：实现 /__perf/direct、/__perf/warm/*、chat、mkBot/rmBot；行为可按场景覆写
function makeMockDeps(overrides = {}) {
  const state = { calls: [], bots: [], warmHandles: new Map(), closed: [], removedBots: [] }
  const defaults = {
    model: 'prov/m-1',
    warmModel: undefined, // 缺省跟随 model
    cancelOnceAt: -1, // 第 N 次 chat（1 起）返回 cancelled+部分文本
    warmupFailPlugin: false,
    warmupFailDirect: false,
    closeFail: false,
    toolOk: true,
  }
  const cfg = { ...defaults, ...overrides }
  const chatOutcome = (ok, extra = {}) => ({
    perf: { totalMs: 100, executionMs: 80, queueMs: 20 },
    model: cfg.model,
    activity: ok && cfg.toolOk ? ['bash'] : [],
    evidence: ok && cfg.toolOk ? { shellOk: true, targetMatch: true } : { shellOk: false, targetMatch: false },
    ...extra,
  })
  const api = async (path, body = {}) => {
    state.calls.push({ path, body })
    await new Promise((r) => setTimeout(r, 1))
    if (path === '/__perf/direct') {
      const isTool = String(body?.text ?? '').includes('bash')
      const ok = body?.text?.includes('预热') || !isTool || cfg.toolOk
      return { ms: 90, http: 200, status: ok ? 'ok' : 'failed', toolCalls: isTool && cfg.toolOk ? 1 : 0,
        activity: isTool && cfg.toolOk ? ['bash'] : [], evidence: isTool && cfg.toolOk ? { shellOk: true, targetMatch: true } : { shellOk: false, targetMatch: false },
        replyBytes: 8, error: null, model: cfg.model }
    }
    if (path === '/__perf/warm/open') {
      if (cfg.warmupFailDirect) return { ms: 5, http: 200, handleId: 'h-warm', warmupStatus: 'failed', model: cfg.warmModel ?? cfg.model }
      const id = `h-${state.warmHandles.size + 1}`
      state.warmHandles.set(id, true)
      return { ms: 5, http: 200, handleId: id, warmupStatus: 'ok', warmupMs: 50, model: cfg.warmModel ?? cfg.model }
    }
    if (path === '/__perf/warm/turn') {
      return { ms: 70, http: 200, status: 'ok', toolCalls: 0, activity: [], evidence: { shellOk: false, targetMatch: false }, replyBytes: 4, error: null, warm: true, model: cfg.warmModel ?? cfg.model }
    }
    if (path === '/__perf/warm/close') {
      if (cfg.closeFail) return { ms: 1, http: 404, error: 'handle 不存在' }
      state.closed.push(body.handleId)
      return { ms: 1, http: 200, ok: true }
    }
    if (path.endsWith('/chat')) {
      state.chatCount = (state.chatCount ?? 0) + 1
      const isWarmup = body?.text?.includes('预热')
      const isTool = body?.text?.includes('bash')
      if (isWarmup && cfg.warmupFailPlugin) {
        return { ms: 30, http: 200, reply: '', outcome: chatOutcome(false, { error: 'warmup boom' }) }
      }
      if (state.chatCount === cfg.cancelOnceAt) {
        return { ms: 40, http: 200, reply: '部分文', outcome: chatOutcome(false, { cancelled: true, perf: { totalMs: 40, executionMs: 30, queueMs: 10 } }) }
      }
      const ok = !isTool || cfg.toolOk
      return { ms: 60, http: 200, reply: ok ? 'OK' : '', outcome: chatOutcome(ok) }
    }
    throw new Error(`mock api 未实现 ${path}`)
  }
  const mkBot = async (name) => { const id = `bot-${state.bots.length + 1}`; state.bots.push(id); return id }
  const rmBot = async (id) => { state.removedBots.push(id) }
  return { api, mkBot, rmBot, state }
}

test('成功全链：模型匹配/时间字段显式/交替顺序/marker 门控/finally close', async () => {
  const d = makeMockDeps()
  const out = await runSampling({ ...d, texts: { qaRounds: 2, toolRounds: 1, warmRounds: 2 } })
  assert.equal(out.overall, 'ok', `overall=ok（${JSON.stringify(out.models)}）`)
  assert.equal(out.exitCode, 0)
  // 每配对模型匹配 true（双侧 prov/m-1）
  for (const pair of ['cold-qa', 'cold-tool', 'warm-plugin', 'warm-direct']) {
    assert.equal(out.models[pair].match, true, `${pair} 模型匹配`)
  }
  // 时间字段四件套显式（插件有拆分；直连拆分为 null）
  const pluginSample = out.results.find((r) => r.pair === 'cold-qa' && r.side === 'plugin')
  assert.deepEqual({ totalMs: pluginSample.totalMs, executionMs: pluginSample.executionMs, queueMs: pluginSample.queueMs }, { totalMs: 100, executionMs: 80, queueMs: 20 })
  assert.ok(Number.isFinite(pluginSample.rttMs), 'rttMs 另列（客户端往返）')
  const directSample = out.results.find((r) => r.pair === 'cold-qa' && r.side === 'direct')
  assert.deepEqual({ executionMs: directSample.executionMs, queueMs: directSample.queueMs }, { executionMs: null, queueMs: null }, '直连拆分显式 null')
  assert.ok(Number.isFinite(directSample.totalMs) && Number.isFinite(directSample.rttMs))
  // marker：仅工具轮与（无）——QA 轮不带 evidenceMarker
  const qaCalls = d.state.calls.filter((c) => c.path === '/__perf/direct' && !c.body.text.includes('bash'))
  assert.ok(qaCalls.every((c) => !c.body.evidenceMarker), 'QA 轮不带 marker')
  const toolCall = d.state.calls.find((c) => c.path === '/__perf/direct' && c.body.text.includes('bash'))
  assert.equal(toolCall.body.evidenceMarker, MARKER, '工具轮带 marker（服务端 testEndpoints 门控）')
  // 交替顺序：round1 direct 先、round2 plugin 先
  const first = out.results.filter((r) => r.pair === 'cold-qa').slice(0, 2).map((r) => r.side)
  assert.deepEqual(first, ['direct', 'plugin'])
  // 暖直连 finally close 被调用
  assert.equal(d.state.closed.length, 1, 'close 恰一次')
})

test('模型不匹配 → incomplete 非零；未知（null）→ incomplete', async () => {
  const bad = makeMockDeps({ warmModel: 'prov/m-1', model: 'prov/m-1' })
  // 让直连与插件不同：直连走 model，插件 chatOutcome 也用同 cfg.model——通过 overrides 分别注入
  const d1 = makeMockDeps({ model: 'prov/A' })
  // 覆写 chat 的模型为 prov/B：借助 cancelOnceAt=-1 且直接改 chatOutcome 不可行——改用 override hook
  const origApi = d1.api
  d1.api = async (path, body) => {
    const r = await origApi(path, body)
    if (path.endsWith('/chat')) r.outcome = { ...r.outcome, model: 'prov/B' }
    if (path === '/__perf/warm/turn' || path === '/__perf/warm/open') r.model = 'prov/B'
    return r
  }
  const out1 = await runSampling({ api: d1.api, mkBot: d1.mkBot, rmBot: d1.rmBot, texts: { qaRounds: 1, toolRounds: 1, warmRounds: 1 } })
  assert.equal(out1.overall, 'incomplete')
  assert.equal(out1.exitCode, 1)
  assert.equal(out1.models['cold-qa'].match, false, '不匹配 → false 记录')

  const d2 = makeMockDeps({ model: null })
  const out2 = await runSampling({ api: d2.api, mkBot: d2.mkBot, rmBot: d2.rmBot, texts: { qaRounds: 1, toolRounds: 1, warmRounds: 1 } })
  assert.equal(out2.overall, 'incomplete')
  assert.equal(out2.models['cold-qa'].match, 'unknown', '未知 → unknown 记录')
})

test('取消带部分文本 → status=cancelled（非 ok）→ overall incomplete 非零', async () => {
  // 第 1 次 chat 即取消（带部分文本）
  const d = makeMockDeps({ cancelOnceAt: 1 })
  const out = await runSampling({ api: d.api, mkBot: d.mkBot, rmBot: d.rmBot, texts: { qaRounds: 1, toolRounds: 1, warmRounds: 1 } })
  const cancelled = out.results.filter((r) => r.status === 'cancelled')
  assert.ok(cancelled.length >= 1, '存在 cancelled 样本')
  assert.ok(cancelled.some((r) => typeof r.reply === 'string' && r.reply.length > 0), '取消样本带部分文本（场景构造）')
  assert.ok(!out.results.some((r) => r.status === 'cancelled' && r.pair === 'cold-qa' && r.side === 'plugin' && r.status === 'ok'))
  assert.equal(out.overall, 'incomplete')
  assert.equal(out.exitCode, 1)
  // 单元锁定：normalizeSample 对「取消+文本」判 cancelled
  assert.equal(normalizeSample({ reply: '部分文本', cancelled: true, http: 200, ms: 5 }).status, 'cancelled')
})

test('warm-plugin 预热失败：本组停止采样并释放（无 5 轮样本、rmBot 调用）', async () => {
  const d = makeMockDeps({ warmupFailPlugin: true })
  const out = await runSampling({ api: d.api, mkBot: d.mkBot, rmBot: d.rmBot, texts: { qaRounds: 1, toolRounds: 1, warmRounds: 5 } })
  const warmSamples = out.results.filter((r) => r.pair === 'warm-plugin')
  assert.equal(warmSamples.length, 1, '仅失败记录一条（5 轮采样全部跳过）')
  assert.equal(warmSamples[0].status, 'failed')
  assert.match(String(warmSamples[0].reason), /warmup/)
  assert.ok(d.state.removedBots.includes(warmSamples[0].botId), 'bot 已释放（rmBot 调用）')
  assert.equal(out.overall, 'incomplete')
  assert.equal(out.exitCode, 1)
})

test('warm-direct 预热失败：跳过 turns 且 close 仍执行（释放）', async () => {
  const d = makeMockDeps({ warmupFailDirect: true })
  const out = await runSampling({ api: d.api, mkBot: d.mkBot, rmBot: d.rmBot, texts: { qaRounds: 1, toolRounds: 1, warmRounds: 5 } })
  const warm = out.results.filter((r) => r.pair === 'warm-direct')
  assert.equal(warm.filter((r) => r.reason !== 'warmup failed').length, 0, '无 turn 样本（本组停止）')
  assert.equal(d.state.closed.length, 1, 'finally close 仍执行（handle 释放）')
  assert.equal(out.overall, 'incomplete')
  assert.equal(out.exitCode, 1)
})

test('close 失败/未知 → cleanup 失败样本 + incomplete 非零（非仅日志）', async () => {
  const d = makeMockDeps({ closeFail: true })
  const out = await runSampling({ api: d.api, mkBot: d.mkBot, rmBot: d.rmBot, texts: { qaRounds: 1, toolRounds: 1, warmRounds: 1 } })
  const closeFail = out.results.find((r) => r.reason === 'close failed (cleanup unconfirmed)')
  assert.ok(closeFail, 'close 失败入结果（非仅日志）')
  assert.equal(closeFail.status, 'failed')
  assert.equal(out.overall, 'incomplete')
  assert.equal(out.exitCode, 1)
})

test('pairModelMatch 单元：相等 true / 不等 false / 任一空 unknown', () => {
  assert.equal(pairModelMatch('a/b', 'a/b'), true)
  assert.equal(pairModelMatch('a/b', 'a/c'), false)
  assert.equal(pairModelMatch(null, 'a/b'), 'unknown')
  assert.equal(pairModelMatch('a/b', null), 'unknown')
  assert.equal(pairModelMatch(null, null), 'unknown')
})
