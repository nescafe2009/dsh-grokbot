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


// bot 清理（真实 finally 内调用）：rmBot 抛错/返回假值 → 记 cleanup 失败并降级（不吞异常）
async function cleanupBot(rmBot, botId, pair, results, degrade, log) {
  if (!botId) return
  try {
    const ok = await rmBot(botId)
    if (ok === false) throw new Error('rmBot 返回 false（DELETE 未成功）')
    log(`  cleanup bot ${botId}: ok`)
  } catch (e) {
    degrade(`${pair} bot 清理失败（${botId}）：${String(e?.message ?? e).slice(0, 80)}`)
    results.push({ pair, side: 'plugin', botId, status: 'failed', reason: 'bot cleanup failed', error: String(e?.message ?? e).slice(0, 120) })
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
        try {
        const p = await api(`/conversations/${bid}/chat`, { text: QA })
        const s = normalizeSample({ round: i, pair: 'cold-qa', side: 'plugin', order: order.indexOf('plugin') + 1, botId: bid,
          reply: (p.reply || '').trim().slice(0, 20) || undefined,
          rttMs: p.rttMs, http: p.http, outcome: p.outcome, error: p.error, cancelled: p.outcome?.cancelled })
        results.push(s)
        log(`  ${i}P: ${s.rttMs}ms status=${s.status} model=${s.model ?? '未知'}`)
        } catch (e) {
          degrade(`cold-qa ${i}P chat 异常：${String(e?.message ?? e).slice(0, 60)}`)
          results.push({ round: i, pair: 'cold-qa', side: 'plugin', botId: bid, status: 'failed', reason: 'chat exception', error: String(e?.message ?? e).slice(0, 120) })
        } finally {
          await cleanupBot(rmBot, bid, 'cold-qa', results, degrade, log)
        }
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
        try {
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
        } catch (e) {
          degrade(`cold-tool ${i}P chat 异常：${String(e?.message ?? e).slice(0, 60)}`)
          results.push({ round: i, pair: 'cold-tool', side: 'plugin', botId: bid, status: 'failed', reason: 'chat exception', error: String(e?.message ?? e).slice(0, 120) })
        } finally {
          await cleanupBot(rmBot, bid, 'cold-tool', results, degrade, log)
        }
      }
    }
  }

  // ===== 暖配对（双侧各预热一次排除；同 round 交替先后；双侧独立清理） =====
  log('== 暖配对（双侧预热 + 同 round 交替） ==')
  {
    // -- 插件侧：预热在 try 内（预热 reject 也走 finally 清理）--
    const warmBot = await mkBot('暖采样')
    let pluginSideAlive = true
    try {
      const warmup = await api(`/conversations/${warmBot}/chat`, { text: WARMUP })
      const wOutcome = warmup.outcome ?? {}
      const warmupOk = warmup.reply && !warmup.reply.includes('未能给出') && !wOutcome.cancelled && !wOutcome.error
      log(`  P warmup: ${warmup.rttMs ?? warmup.ms}ms ok=${warmupOk} (excluded)`)
      if (!warmupOk) {
        pluginSideAlive = false
        degrade('warm-plugin 预热失败：插件侧停止采样并释放 bot')
        results.push({ pair: 'warm-plugin', side: 'plugin', botId: warmBot, status: 'failed', reason: 'warmup failed', warmupRttMs: warmup.rttMs ?? null, model: wOutcome.model ?? null })
      } else if (wOutcome.cancelled === true || /cancel/i.test(String(wOutcome.stopReason ?? ''))) {
        pluginSideAlive = false
        degrade('warm-plugin 预热取消：插件侧停止采样')
        results.push({ pair: 'warm-plugin', side: 'plugin', botId: warmBot, status: 'cancelled', reason: 'warmup cancelled' })
      }
    } catch (e) {
      pluginSideAlive = false
      degrade(`warm-plugin 预热异常：${String(e?.message ?? e).slice(0, 60)}`)
      results.push({ pair: 'warm-plugin', side: 'plugin', botId: warmBot, status: 'failed', reason: 'warmup exception', error: String(e?.message ?? e).slice(0, 120) })
    }

    // -- 直连侧：open（预热）在 try 内（handle 取得后 close 必达）--
    let openHandleId = null
    let directSideAlive = false
    try {
      const open = await api('/__perf/warm/open', { text: WARMUP })
      openHandleId = open.handleId ?? null
      if (!openHandleId) {
        degrade('warm-direct open 失败')
        results.push({ pair: 'warm-direct', side: 'direct', status: 'failed', reason: 'open failed', error: open.error ?? null })
      } else {
        log(`  D warmup: ${open.warmupMs}ms status=${open.warmupStatus} (excluded)`)
        if (open.warmupStatus === 'cancelled') {
          degrade('warm-direct 预热取消：直连侧停止采样')
          results.push({ pair: 'warm-direct', side: 'direct', status: 'cancelled', reason: 'warmup cancelled', warmupMs: open.warmupMs, model: open.model ?? null })
        } else if (open.warmupStatus !== 'ok') {
          degrade('warm-direct 预热失败：直连侧停止采样')
          results.push({ pair: 'warm-direct', side: 'direct', status: 'failed', reason: 'warmup failed', warmupMs: open.warmupMs, model: open.model ?? null })
        } else {
          directSideAlive = true
        }
      }
    } catch (e) {
      degrade(`warm-direct open 异常：${String(e?.message ?? e).slice(0, 60)}`)
      results.push({ pair: 'warm-direct', side: 'direct', status: 'failed', reason: 'open exception', error: String(e?.message ?? e).slice(0, 120) })
    }

    // -- 同 round 交替（奇数轮 direct 先，偶数轮 plugin 先；order 记录先后）--
    try {
      for (let i = 1; i <= warmRounds; i++) {
        const order = alternatingOrder(i)
        for (const side of order) {
          if (side === 'direct' && directSideAlive) {
            try {
              const d = await api('/__perf/warm/turn', { handleId: openHandleId, text: QA })
              const s = normalizeSample({ ...d, round: i, pair: 'warm-direct', side: 'direct', order: order.indexOf('direct') + 1,
                reply: (d.replyBytes ?? 0) > 0 ? '(direct)' : undefined,
                status: d.status, error: d.error,
                toolEvidence: bashToolEvidence(d), targetMatch: false })
              results.push(s)
              log(`  ${i}D(${order.indexOf('direct') + 1}): ${s.rttMs}ms status=${s.status}`)
            } catch (e) {
              directSideAlive = false // 直连侧停止（后续轮只跑插件侧）
              degrade(`warm-direct ${i}D turn 异常：${String(e?.message ?? e).slice(0, 60)}`)
              results.push({ round: i, pair: 'warm-direct', side: 'direct', order: order.indexOf('direct') + 1, status: 'failed', reason: 'turn exception', error: String(e?.message ?? e).slice(0, 120) })
            }
          } else if (side === 'plugin' && pluginSideAlive) {
            try {
              const p = await api(`/conversations/${warmBot}/chat`, { text: QA })
              const s = normalizeSample({ round: i, pair: 'warm-plugin', side: 'plugin', order: order.indexOf('plugin') + 1, botId: warmBot,
                rttMs: p.rttMs, http: p.http, reply: (p.reply || '').trim().slice(0, 20) || undefined,
                outcome: p.outcome ?? {}, error: p.outcome?.error, cancelled: p.outcome?.cancelled,
                status: p.reply && !p.reply.includes('未能给出') && !p.outcome?.cancelled && !p.outcome?.error ? 'ok' : 'empty' })
              results.push(s)
              log(`  ${i}P(${order.indexOf('plugin') + 1}): ${s.rttMs}ms status=${s.status}`)
            } catch (e) {
              pluginSideAlive = false
              degrade(`warm-plugin ${i}P chat 异常：${String(e?.message ?? e).slice(0, 60)}`)
              results.push({ round: i, pair: 'warm-plugin', side: 'plugin', order: order.indexOf('plugin') + 1, botId: warmBot, status: 'failed', reason: 'chat exception', error: String(e?.message ?? e).slice(0, 120) })
            }
          }
        }
      }
    } finally {
      // 双侧清理：close 与 rmBot 均真实 finally，失败各自记 cleanup 失败
      if (openHandleId) {
        const closed = await api('/__perf/warm/close', { handleId: openHandleId }).catch((e) => ({ ok: false, error: String(e) }))
        if (closed?.ok !== true) {
          degrade(`warm-direct close 失败（cleanup 未确认）：${closed?.error ?? `http=${closed?.http ?? 'unknown'}`}`)
          results.push({ pair: 'warm-direct', side: 'direct', status: 'failed', reason: 'close failed (cleanup unconfirmed)', closeDetail: { http: closed?.http ?? null, error: closed?.error ?? null } })
        } else {
          log('  D close: ok')
        }
      }
      await cleanupBot(rmBot, warmBot, 'warm-plugin', results, degrade, log)
    }
  }

  // ===== 模型证据三分：ID 匹配 / 目录可用 / 参数确认 =====
  // 语义澄清：白名单=允许记录的非秘密参数字段；/model-catalog 仅含 ID/name——
  // 目录成员 + ID 相等不能证明实际采样参数一致。参数未取证 → 明确 unknown，
  // 真实性能 overall 保持 incomplete（不猜默认值、不新增接口）。
  const models = {}
  let catalog = null // 可用性清单（仅 ID 语义）：deps.listModels 不可得 → null
  if (typeof deps.listModels === 'function') {
    catalog = await deps.listModels().then((list) => (Array.isArray(list) ? new Set(list.map(String)) : null)).catch(() => null)
  }
  const allModels = results.map((r) => r.model ?? null).filter(Boolean)
  const reference = allModels[0] ?? null
  for (const pair of ['cold-qa', 'cold-tool', 'warm-plugin', 'warm-direct']) {
    const direct = [...new Set(results.filter((r) => r.pair === pair && r.side === 'direct').map((r) => r.model ?? null))].join('|')
    const plugin = [...new Set(results.filter((r) => r.pair === pair && r.side === 'plugin').map((r) => r.model ?? null))].join('|')
    const inPair = [...new Set(results.filter((r) => r.pair === pair).map((r) => r.model ?? null))]
    const hasUnknown = inPair.includes(null) || inPair.length === 0 || !reference
    // 1) ID 匹配：同组双侧 ID 相等（与基准一致）
    const idMatch = hasUnknown ? null : (inPair.every((m) => m === reference) ? true : false)
    // 2) 目录可用：基准 ID 在 /model-catalog（仅证明 ID 存在，不证明参数）
    const catalogAvailable = !reference ? null : (catalog === null ? null : catalog.has(String(reference)))
    // 3) 参数确认：实际采样参数（非秘密字段）是否取证一致——当前未取证（不猜默认值、不新增接口）
    const paramsConfirmed = false
    const match = idMatch === false ? false : 'unknown' // 参数未确认 → 完整配对不能 PASS
    models[pair] = {
      direct: direct || 'unknown', plugin: plugin || 'unknown', reference: reference ?? 'unknown',
      idMatch, catalogAvailable, paramsConfirmed,
      paramsNote: '参数未取证（不猜默认值）——完整配对需参数确认证据',
      match,
    }
    if (match !== true) {
      const why = idMatch === null ? '样本模型缺失' : (idMatch === false ? `组内 ID 不一致（direct=${direct} plugin=${plugin}）` : (catalogAvailable === false ? `基准 ${reference} 不在目录` : (catalogAvailable === null ? '目录不可得' : '参数未确认')))
      degrade(`配对 ${pair} 不能完整判定：${why}`)
    }
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
