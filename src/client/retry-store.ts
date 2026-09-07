/*
 * R2-B：失败/结果未知请求的重试记录（按会话隔离）。
 * 组件切换（同类视图复用 state）不会串会话：记录绑定 conversationId，
 * 当前会话只读自己的；切回原会话仍保留重试身份（原 requestId/载荷）。
 */
export interface PendingRetry {
  conversationId: string
  requestId: string
  text: string
  taskId: string | null
}

const store = new Map<string, PendingRetry>()

export function setPendingRetry(retry: PendingRetry | null): void {
  if (retry) store.set(retry.conversationId, retry)
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
