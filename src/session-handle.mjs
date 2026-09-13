// A persisted session may already be published by the native session UI.
// Borrow the exact registered agent; never dispose resources owned by that UI.
export async function openSessionHandle(registry, sessionId, options) {
  const borrow = () => {
    const agent = registry.get?.(sessionId)
    if (!agent || agent.session?.id !== sessionId) return null
    return { agent, borrowed: true, dispose: async () => {} }
  }
  const live = borrow()
  if (live) return live
  try {
    return await registry.resume({ resumeSessionId: sessionId, ...options })
  } catch (error) {
    // Publication may race our first lookup. Only this precise conflict permits
    // reuse; persistence and setup failures must not lose history via new IDs.
    if (String(error?.message) === `cannot prepare session "${sessionId}" while it is live`) {
      const published = borrow()
      if (published) return published
    }
    throw error
  }
}
