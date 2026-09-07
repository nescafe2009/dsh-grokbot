// 派发与协调的纯逻辑（#3 审核修补批）：
// - resolveDispatchTarget：team_send_task 目标解析（授权范围/精确 id/歧义拒绝）
// - WakeScheduler：协调唤醒限频的「合并延后」状态机（窗口内事件挂 pending，不丢弃）

/**
 * 解析派发目标。
 * @param bots 全体 crew bots（含 id/name）
 * @param conversation 当前会话（群）或 null（DM/无会话上下文）
 * @param ref { member_id?: string, member_name?: string }
 * @returns { ok: boolean, bot?: object, error?: string, candidates?: string[] }
 *   群上下文：目标必须是群成员（授权范围）；DM 上下文：全 crew 可选。
 *   精确 member_id 优先；member_name 仅在授权范围内唯一命中时兼容，歧义拒绝。
 */
export function resolveDispatchTarget(bots, conversation, ref) {
  const scope = conversation
    ? bots.filter((b) => conversation.memberBotIds.includes(b.id))
    : bots
  const scopeNames = scope.map((b) => b.name).join('、')

  if (ref?.member_id) {
    const hit = scope.find((b) => b.id === ref.member_id)
    if (hit) return { ok: true, bot: hit }
    return {
      ok: false,
      error: `目标 ${ref.member_id} 不在授权范围内${conversation ? `（本群成员：${scopeNames}）` : ''}，未派发。群外协作需要用户显式把成员拉入群。`,
    }
  }

  const name = String(ref?.member_name || '').trim()
  if (!name) return { ok: false, error: '缺少 member_id 或 member_name' }

  const exact = scope.filter((b) => b.name === name)
  if (exact.length === 1) return { ok: true, bot: exact[0] }
  if (exact.length > 1) {
    return { ok: false, error: `名字「${name}」在授权范围内匹配多位成员（${exact.map((b) => b.name).join('、')}），请用 member_id 精确指定。`, candidates: exact.map((b) => b.id) }
  }
  const fuzzy = scope.filter((b) => b.name.includes(name) || name.includes(b.name))
  if (fuzzy.length === 1) return { ok: true, bot: fuzzy[0] }
  if (fuzzy.length > 1) {
    return { ok: false, error: `「${name}」在授权范围内歧义（${fuzzy.map((b) => b.name).join('、')}），请用 member_id 或全名。`, candidates: fuzzy.map((b) => b.id) }
  }
  return {
    ok: false,
    error: `未找到「${name}」${conversation ? `（本群成员：${scopeNames}）` : ''}，未派发。`,
  }
}

/**
 * 协调唤醒限频状态机（合并延后，不丢事件）。
 * request(key) —— 窗口外立即触发；窗口内挂 pending 并确保窗口尾有且仅有一个消费定时器。
 * onFired(key) —— 协调回合完成后回调：刷新 lastFiredAt；若仍有 pending，
 *                  在窗口结束时再消费（与窗口尾定时器同一路径，幂等）。
 * pending 的消费保证：request 挂起时必安排定时器；定时器/onFired 谁先到窗口尾谁消费，
 * 消费时清除 pending 并触发 fire——不存在「挂起后无人消费」的路径。
 * 全部时间经注入的 now()，虚拟时钟可测。
 */
export class WakeScheduler {
  constructor({ intervalMs = 60_000, fire, delay, now = () => Date.now() }) {
    if (typeof fire !== 'function') throw new Error('WakeScheduler 需要 fire 回调')
    this.intervalMs = intervalMs
    this.fire = fire
    this.delay = delay ?? ((ms, fn) => setTimeout(fn, ms))
    this.now = now
    this.state = new Map() // key → { lastFiredAt: number, pending: bool, timer?: handle }
  }

  _armPending(key) {
    const st = this.state.get(key)
    if (!st || !st.pending || st.timer !== undefined) return
    const wait = Math.max(0, this.intervalMs - (this.now() - st.lastFiredAt))
    st.timer = this.delay(wait, () => {
      const cur = this.state.get(key)
      if (!cur) return
      cur.timer = undefined
      cur.lastFiredAt = this.now()
      if (cur.pending) {
        cur.pending = false
        this.fire(key)
      }
    })
  }

  request(key) {
    const st = this.state.get(key) ?? { lastFiredAt: -Infinity, pending: false }
    this.state.set(key, st)
    if (this.now() - st.lastFiredAt < this.intervalMs) {
      st.pending = true
      this._armPending(key)
      return 'pending'
    }
    st.pending = false
    st.lastFiredAt = this.now() // fire 即标记：回合进行中的后续 request 进入 pending 合并
    this.fire(key)
    return 'fired'
  }

  onFired(key) {
    const st = this.state.get(key)
    if (!st) return
    st.lastFiredAt = this.now()
    this._armPending(key)
  }
}
