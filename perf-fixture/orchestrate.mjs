// 效率配对采样编排（可测核心）——由 sample.mjs 以真实 HTTP 依赖调用，测试以 mock 依赖驱动。
//
// 契约：
//  - 模型参数：每样本记录服务端返回的 model（provider/model）；配对匹配条件
//    pairModelMatch = 同 pair 双侧 model 均非空且相等；未知（null）/不等 → overall incomplete
//  - 时间字段：totalMs（插件=perf.totalMs，直连=服务端 ms）/ executionMs+queueMs（插件拆分，直连 null）/
//    rttMs（客户端往返，另列）——四字段全部显式（null 明示）
//  - 取消：cancelled 即使有部分文本也非 ok（status='cancelled'）
//  - 预热非 ok：该组停止采样并释放（warm-plugin→rmBot；warm-direct→跳过 turns 且 finally close）
//  - close 失败/未知：记 cleanup 失败样本 + overall incomplete + exitCode 1（不只日志）
//  - marker：仅工具配对轮与暖直连轮携带 evidenceMarker（服务端 testEndpoints 门控不变）
import { bashToolEvidence, targetEvidence } from './evidence.mjs'

export const MARKER = 'COLD-TOOL'

// ===== 采样结果归一化 =====
// 插件 chat API 返回 { reply, ..., outcome }（cancelled/error/perf/model/activity 在 outcome）；直连顶层。
export function normalizeSample(raw) {
  const outcome = raw.outcome ?? {}
  const isCancelled = raw.cancelled === true || outcome.cancelled === true || raw.status === 'cancelled'
  const isFetchError = raw.status === 'fetch_error' || raw.error?.includes?.('timeout')
  const hasError = raw.error || outcome.error
  const isEmpty = (raw.reply === undefined && (raw.replyBytes ?? 0) > 0) ? false : (!raw.reply || raw.reply?.includes?.('未能给出文本回复'))
  const isHttpErr = raw.http >= 400
  const derived = isFetchError || isCancelled || isEmpty || isHttpErr || hasError
    ? { status: isCancelled ? 'cancelled' : 'failed' } // 取消即使有部分文本也不算 ok
    : { status: raw.status || 'ok' }
  // 时间字段显式化：totalMs/executionMs/queueMs（服务端视角）+ rttMs（客户端往返，独立字段另列）。
  // 直连（无 outcome.perf、有服务端 ms）按定义补齐：queue=0（无队列），execution=total=服务端 ms
  const perf = outcome.perf ?? {}
  const directish = !perf.totalMs && Number.isFinite(raw.ms)
  return {
    ...raw,
    ...derived,
    model: raw.model ?? outcome.model ?? null, // 实际 provider/model（未知=null → 配对匹配 unknown）
    totalMs: perf.totalMs ?? (Number.isFinite(raw.ms) ? raw.ms : null),
    executionMs: perf.executionMs ?? (directish ? raw.ms : null),
    queueMs: perf.queueMs ?? (directish ? 0 : null),
    rttMs: raw.rttMs ?? null,
  }
}

export function alternatingOrder(round) {
  return round % 2 === 1 ? ['direct', 'plugin'] : ['plugin', 'direct']
}

// 配对模型匹配：双侧非空且相等 → true；任一未知（null）→ 'unknown'；不等 → false
export function pairModelMatch(directModel, pluginModel) {
  if (!directModel || !pluginModel) return 'unknown'
  return directModel === pluginModel
}

/**
 * @param {object} deps
 * @param {(path:string, body?:object)=>Promise<object>} deps.api
 * @param {(name:string)=>Promise<string|undefined>} deps.mkBot
 * @param {(id:string)=>Promise<void>} deps.rmBot
 * @param {{qa?:string, tool?:string, warmup?:string, qaRounds?:number, toolRounds?:number, warmRounds?:number}} [deps.texts]
 * @param {(line:string)=>void} [deps.log]
 */
export async function runSampling(deps) {
  const { api, mkBot, rmBot } = deps
  const log = deps.log ?? (() => {})
  const QA = deps.texts?.qa ?? '配对冷A：只回复 OK。'
  const TOOL = deps.texts?.tool ?? `配对冷B：用 bash 执行 echo ${MARKER} 并回复输出。`
  const WARMUP = deps.texts?.warmup ?? '预热：只回复 OK。'
  const qaRounds = deps.texts?.qaRounds ?? 4
  const toolRounds = deps.texts?.toolRounds ?? 2
  const warmRounds = deps.texts?.warmRounds ?? 5

  const results = []
  let overall = 'ok'
  const degrade = (why) => { overall = overall === 'failed' ? 'failed' : 'incomplete'; log(`  [degrade] ${why}`) }

  // ===== 冷↔冷 问答（交替先后） =====
  log('== 冷↔冷 问答（交替先后） ==')
  for (let i = 1; i <= qaRounds; i++) {
    const order = alternatingOrder(i)
    for (const side of order) {
      if (side === 'direct') {
        const d = await api('/__perf/direct', { text: QA })
        const s = normalizeSample({ ...d, round: i, pair: 'cold-qa', side: 'direct', order: order.indexOf('direct') + 1 }) // d 已含独立 rttMs
        results.push(s)
        log(`  ${i}D: ${s.rttMs}ms status=${s.status} model=${s.model ?? '未知'}`)
      } else {
        const bid = await mkBot(`冷${i}`)
        const p = await api(`/conversations/${bid}/chat`, { text: QA })
        const s = normalizeSample({ round: i, pair: 'cold-qa', side: 'plugin', order: order.indexOf('plugin') + 1, botId: bid,
          reply: (p.reply || '').trim().slice(0, 20) || undefined,
          rttMs: p.rttMs, http: p.http, outcome: p.outcome, error: p.error, cancelled: p.outcome?.cancelled })
        results.push(s)
        log(`  ${i}P: ${s.rttMs}ms status=${s.status} model=${s.model ?? '未知'}`)
        await rmBot(bid)
      }
    }
  }

  // ===== 冷↔冷 工具（交替先后；两侧同标准证据） =====
  log('== 冷↔冷 工具（交替先后） ==')
  for (let i = 1; i <= toolRounds; i++) {
    const order = alternatingOrder(i + qaRounds)
    for (const side of order) {
      if (side === 'direct') {
        const d = await api('/__perf/direct', { text: TOOL, evidenceMarker: MARKER })
        const hasTools = bashToolEvidence(d)
        const matched = targetEvidence(d, MARKER)
        const s = normalizeSample({ ...d, round: i, pair: 'cold-tool', side: 'direct', order: order.indexOf('direct') + 1,
          status: d.status === 'ok' && hasTools && matched ? 'ok' : (d.status === 'ok' ? 'failed' : d.status),
          toolEvidence: hasTools, targetMatch: matched })
        results.push(s)
        log(`  ${i}D: ${s.rttMs}ms tools=${d.toolCalls} evidence=${hasTools} status=${s.status}`)
      } else {
        const bid = await mkBot(`工具${i}`)
        const p = await api(`/conversations/${bid}/chat`, { text: TOOL, evidenceMarker: MARKER })
        const hasTools = bashToolEvidence(p.outcome)
        const matched = targetEvidence(p.outcome, MARKER)
        const outcome = p.outcome ?? {}
        const s = normalizeSample({ round: i, pair: 'cold-tool', side: 'plugin', order: order.indexOf('plugin') + 1, botId: bid,
          rttMs: p.rttMs, http: p.http, reply: (p.reply || '').trim().slice(0, 30) || undefined,
          outcome, error: outcome.error, cancelled: outcome.cancelled,
          toolEvidence: hasTools, targetMatch: matched,
          status: hasTools && matched && !outcome.cancelled && !outcome.error ? 'ok' : 'failed' })
        results.push(s)
        log(`  ${i}P: ${s.rttMs}ms tools=${hasTools} target=${matched} status=${s.status}`)
        await rmBot(bid)
      }
    }
  }

  // ===== 暖插件（预热 1 次排除；预热非 ok → 停组并释放） =====
  log('== 暖插件（预热1次 + 采样同文本） ==')
  {
    const warmBot = await mkBot('暖采样')
    const warmup = await api(`/conversations/${warmBot}/chat`, { text: WARMUP })
    const wOutcome = warmup.outcome ?? {}
    const warmupOk = warmup.reply && !warmup.reply.includes('未能给出') && !wOutcome.cancelled && !wOutcome.error
    log(`  warmup: ${warmup.ms}ms ok=${warmupOk} (excluded)`)
    try {
      if (!warmupOk) {
        degrade('warm-plugin 预热失败：本组停止采样并释放 bot')
        results.push({ pair: 'warm-plugin', side: 'plugin', botId: warmBot, status: 'failed', reason: 'warmup failed', warmupMs: warmup.rttMs ?? warmup.ms, model: wOutcome.model ?? null })
      } else {
        for (let i = 1; i <= warmRounds; i++) {
          const p = await api(`/conversations/${warmBot}/chat`, { text: QA })
          const s = normalizeSample({ round: i, pair: 'warm-plugin', side: 'plugin', botId: warmBot,
            rttMs: p.rttMs, http: p.http, reply: (p.reply || '').trim().slice(0, 20) || undefined,
            outcome: p.outcome ?? {}, error: p.outcome?.error, cancelled: p.outcome?.cancelled,
            status: p.reply && !p.reply.includes('未能给出') && !p.outcome?.cancelled && !p.outcome?.error ? 'ok' : 'empty' })
          results.push(s)
          log(`  ${i}: ${s.rttMs}ms status=${s.status}`)
        }
      }
    } finally {
      await rmBot(warmBot) // 真实 finally：无论成败/异常释放
    }
  }

  // ===== 暖直连（专用 handle：open 预热 + turns + finally close） =====
  log('== 暖直连（专用 handle） ==')
  {
    const open = await api('/__perf/warm/open', { text: WARMUP })
    if (!open.handleId) {
      degrade('warm-direct open 失败')
      results.push({ pair: 'warm-direct', side: 'direct', status: 'failed', reason: 'open failed', error: open.error ?? null })
    } else {
      log(`  warmup: ${open.warmupMs}ms status=${open.warmupStatus} (excluded)`)
      try {
        if (open.warmupStatus !== 'ok') {
          degrade('warm-direct 预热失败：本组停止采样')
          results.push({ pair: 'warm-direct', side: 'direct', status: 'failed', reason: 'warmup failed', warmupMs: open.warmupMs, model: open.model ?? null })
        } else {
          for (let i = 1; i <= warmRounds; i++) {
            const d = await api('/__perf/warm/turn', { handleId: open.handleId, text: QA })
            const s = normalizeSample({ ...d, round: i, pair: 'warm-direct', side: 'direct',
              reply: (d.replyBytes ?? 0) > 0 ? '(direct)' : undefined,
              status: d.status, error: d.error,
              toolEvidence: bashToolEvidence(d), targetMatch: false })
            results.push(s)
            log(`  ${i}D: ${s.rttMs}ms status=${s.status}${d.error ? ` error=${String(d.error).slice(0, 40)}` : ''}`)
          }
        }
      } catch (turnError) {
        // turn 异常（api reject）：保留 incomplete 证据，finally close 仍执行
        degrade(`warm-direct turn 异常：${String(turnError?.message ?? turnError).slice(0, 80)}`)
        results.push({ pair: 'warm-direct', side: 'direct', status: 'failed', reason: 'turn exception', error: String(turnError?.message ?? turnError).slice(0, 120) })
      } finally {
        // 真实 finally close：close 失败/未知必须记 cleanup 失败（非仅日志）
        const closed = await api('/__perf/warm/close', { handleId: open.handleId }).catch((e) => ({ ok: false, error: String(e) }))
        if (closed?.ok !== true) {
          degrade(`warm-direct close 失败（cleanup 未确认）：${closed?.error ?? `http=${closed?.http ?? 'unknown'}`}`)
          results.push({ pair: 'warm-direct', side: 'direct', status: 'failed', reason: 'close failed (cleanup unconfirmed)', closeDetail: { http: closed?.http ?? null, error: closed?.error ?? null } })
        } else {
          log('  close: ok')
        }
      }
    }
  }

  // ===== 模型参数匹配（冷冷暖暖同模型条件：全四组与全局基准一致） =====
  // 基准 = 首个非空模型（冷组优先）；任一组未知（null）→ unknown；组内/与基准不等 → false
  const models = {}
  const allModels = results.map((r) => r.model ?? null).filter(Boolean)
  const reference = allModels[0] ?? null
  for (const pair of ['cold-qa', 'cold-tool', 'warm-plugin', 'warm-direct']) {
    const inPair = [...new Set(results.filter((r) => r.pair === pair).map((r) => r.model ?? null))]
    const direct = [...new Set(results.filter((r) => r.pair === pair && r.side === 'direct').map((r) => r.model ?? null))].join('|')
    const plugin = [...new Set(results.filter((r) => r.pair === pair && r.side === 'plugin').map((r) => r.model ?? null))].join('|')
    const unknown = inPair.includes(null) || inPair.length === 0 || !reference
    const mismatch = !unknown && inPair.some((m) => m !== reference)
    const match = unknown ? 'unknown' : (mismatch ? false : true)
    models[pair] = { direct: direct || 'unknown', plugin: plugin || 'unknown', reference: reference ?? 'unknown', match }
    if (match !== true) degrade(`配对 ${pair} 模型参数不匹配或未知（direct=${direct || 'unknown'} plugin=${plugin || 'unknown'} 基准=${reference ?? 'unknown'}）`)
  }

  // ===== 汇总 =====
  const nonOk = results.filter((r) => r.status !== 'ok')
  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'failed').length,
    cancelled: results.filter((r) => r.status === 'cancelled').length,
    empty: results.filter((r) => r.status === 'empty').length,
    blocked: results.filter((r) => r.status === 'blocked').length,
  }
  if (nonOk.length > 0) overall = overall === 'incomplete' ? 'incomplete' : (summary.failed > 0 ? 'failed' : 'incomplete')
  return { results, summary, models, overall, exitCode: overall === 'ok' ? 0 : 1 }
}
