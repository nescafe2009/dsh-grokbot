/** Explicit transport identity only; identical text can be two intentional messages. */
export function uniqueMessages<T extends {messageId?: string; requestId?: string; role: string}>(messages: T[]): T[] {
  const seen = new Set<string>()
  return messages.filter(message => {
    const key = message.messageId || (message.requestId ? `${message.requestId}:${message.role}` : null)
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
