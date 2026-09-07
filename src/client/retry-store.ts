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
}

/** 服务端去重保留期（与 dedup.mjs 一致：失败 30s / 成功 5min） */
export const RETRY_GUARANTEE_MS = 5 * 60_000

const store = new Map<string, PendingRetry>()

export function setPendingRetry(retry: PendingRetry): void {
  store.set(retry.conversationId, retry)
}

export function clearPendingRetry(conversationId: string): void {
  store.delete(conversationId)
}

export function getPendingRetry(conversationId: string): PendingRetry | null {
  return store.get(conversationId) ?? null
}

/** 重试仅作用于原会话：当前会话与记录不一致时不发送（防 URL 取到新会话） */
export function retryMatches(retry: PendingRetry | null, conversationId: string): boolean {
  return Boolean(retry) && retry!.conversationId === conversationId
}

/** 是否仍在去重保证窗口内（UI 据此区分安全重试/需确认的重新执行） */
export function withinGuarantee(retry: PendingRetry, now = Date.now()): boolean {
  return now - retry.createdAt < RETRY_GUARANTEE_MS
}
