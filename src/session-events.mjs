// Always reacquire: native snapshots are immutable and change after appends.
export function sessionEvents(session) {
  if (!session) throw new Error('SESSION_EVENTS_UNAVAILABLE: 会话尚未就绪')
  const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events
  if (!Array.isArray(events)) throw new Error('SESSION_EVENTS_UNAVAILABLE: 宿主会话事件接口不兼容，请更新插件后重试')
  return events
}
