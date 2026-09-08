/*
 * R2-B：失败/结果未知请求的重试记录（按会话隔离）。
 * 组件切换（同类视图复用 state）不会串会话：记录绑定 conversationId，
 * 当前会话只读自己的；切回原会话仍保留重试身份（原 requestId/载荷）。
 * 含创建时间与保留期判断：超期后重试不再保证服务端去重（失败 30s/成功 5min，
 * 宿主重启清空注册表）——UI 需显式区分「重试原请求」与「重新执行」。
 */
export interface PendingRetry {
  conversationId: string
  requestId: string
  text: string
  taskId: string | null
  createdAt: number
  seq?: number // 请求序号（allocateSeq 分配）——旧请求不能覆盖较新的
}

/**
 * 服务端去重保留边界（与 dedup.mjs 一致：失败 30s / 成功 5min / 宿主重启清空）。
 * 注意：这是服务端行为，客户端无法核实请求落在哪个边界（失败或成功未知、重启未知）——
 * 因此 UI 不据此显示"安全"承诺；withinGuarantee 仅用于文案分级（高/低重复风险），
 * 重试始终复用原 requestId：命中服务端缓存/在途即返回原结果（免费），未命中才执行。
 */
export const RETRY_GUARANTEE_MS = 5 * 60_000
export const RETRY_FAILURE_GUARANTEE_MS = 30_000

const store = new Map<string, PendingRetry>()
/** 每会话已结算（成功清除/失败写入）的最高序号——旧回调不能低于此水印写槽 */
const settledWatermark = new Map<string, number>()

export function setPendingRetry(retry: PendingRetry): void {
  const existing = store.get(retry.conversationId)
  if (existing && (existing.seq ?? 0) > (retry.seq ?? 0)) {
    return
  }
  // 低于已结算水印的旧失败不能重新占据重试槽（新请求已成功/新失败已写入）
  const wm = settledWatermark.get(retry.conversationId) ?? 0
  if ((retry.seq ?? 0) < wm) {
    return
  }
  // 同一请求（requestId 相同）重复失败：保留首次创建时间（不延长保留期）；新请求失败用新时间
  const record = existing && existing.requestId === retry.requestId ? { ...retry, createdAt: existing.createdAt } : retry
  store.set(retry.conversationId, record)
  settledWatermark.set(retry.conversationId, Math.max(wm, retry.seq ?? 0))
}

/** 新发送前声明该会话的下一个请求序号（send 递增后写 store），旧回调只能写 ≤ 自己序号的槽 */
let nextSeq = 1
export function allocateSeq(): number {
  return nextSeq++
}

export function clearPendingRetry(conversationId: string, seq?: number): void {
  store.delete(conversationId)
  if (seq !== undefined) {
    const wm = settledWatermark.get(conversationId) ?? 0
    settledWatermark.set(conversationId, Math.max(wm, seq))
  }
}

export function getPendingRetry(conversationId: string): PendingRetry | null {
  return store.get(conversationId) ?? null
}

/** 重试仅作用于原会话：当前会话与记录不一致时不发送（防 URL 取到新会话） */
export function retryMatches(retry: PendingRetry | null, conversationId: string): boolean {
  return Boolean(retry) && retry!.conversationId === conversationId
}

/**
 * 风险分级（仅文案，不是安全承诺）：30s 内高把握命中去重（失败缓存最短边界）；
 * 30s~5min 中风险；超 5min 低把握（且服务端重启会清空，任何时候重启都不保证）。
 * 首次失败时间不因重复失败刷新（同 requestId 重复失败保留原 createdAt，见 setPendingRetry）。
 */
export function retryRiskLevel(retry: PendingRetry, now = Date.now()): 'high' | 'medium' | 'low' {
  const age = now - retry.createdAt
  if (age < RETRY_FAILURE_GUARANTEE_MS) return 'high'
  if (age < RETRY_GUARANTEE_MS) return 'medium'
  return 'low'
}
