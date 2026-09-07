/*
 * R2-B：聊天请求去重注册表（可单测）。
 * - 在途共享：同 requestId 并发请求共享同一执行 Promise（副作用只发生一次）
 * - 结果缓存：成功 TTL 长（默认 5 分钟）；失败短 TTL（默认 30s）内重试返回失败结果，
 *   不盲目重做可能已发生的副作用；短 TTL 过后允许显式重试
 * - 载荷冲突：同 requestId 不同载荷返回冲突错误（不执行）
 */
export class ChatRequestRegistry {
  constructor({ successTtlMs = 5 * 60_000, failureTtlMs = 30_000, now = () => Date.now() } = {}) {
    this.successTtlMs = successTtlMs
    this.failureTtlMs = failureTtlMs
    this.now = now
    this.inFlight = new Map() // id -> { payload, promise }
    this.results = new Map() // id -> { at, ok, result, error, payload }
  }

  _samePayload(a, b) {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  /**
   * exec(payload) -> result（同步签名，内部可异步）。
   * 返回 { deduped, result, error }：
   * - 命中缓存/共享在途：deduped=true
   * - 载荷冲突：error={status:409,...}
   */
  begin(id, payload, exec) {
    if (!id) return { deduped: false, result: null, error: null, run: () => Promise.resolve(exec()) }
    const t = this.now()
    const cached = this.results.get(id)
    if (cached) {
      const ttl = cached.ok ? this.successTtlMs : this.failureTtlMs
      if (t - cached.at < ttl) {
        if (!this._samePayload(cached.payload, payload)) {
          return { deduped: false, result: null, error: { status: 409, message: `requestId ${id} 已绑定不同载荷` } }
        }
        return cached.ok
          ? { deduped: true, result: cached.result, error: null, run: null }
          : { deduped: true, result: null, error: cached.error, run: null }
      }
      this.results.delete(id)
    }
    const flying = this.inFlight.get(id)
    if (flying) {
      if (!this._samePayload(flying.payload, payload)) {
        return { deduped: false, result: null, error: { status: 409, message: `requestId ${id} 在途请求载荷不同` } }
      }
      return { deduped: true, result: null, error: null, run: () => flying.promise }
    }
    const promise = Promise.resolve()
      .then(() => exec())
      .then(
        (result) => {
          this.results.set(id, { at: this.now(), ok: true, result, payload })
          return { ok: true, result }
        },
        (error) => {
          // 失败短缓存：重试不盲目重做（副作用可能已部分发生）；TTL 过后放行显式重试
          this.results.set(id, { at: this.now(), ok: false, error: String(error?.message || error), payload })
          return { ok: false, error: String(error?.message || error) }
        },
      )
      .finally(() => { this.inFlight.delete(id) })
    this.inFlight.set(id, { payload, promise })
    return { deduped: false, result: null, error: null, run: () => promise }
  }
}
