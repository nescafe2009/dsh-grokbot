// 采样 HTTP 客户端——rttMs 为独立字段：客户端往返耗时不受响应体字段覆盖（此前 ...j 把 ms 覆盖成服务端耗时）。
// 有界超时覆盖完整请求周期（含响应体读取/解析）。
export function makeClient({ baseUrl, token, timeoutMs = 120000 }) {
  async function fetchWithTimeout(url, opts, timeoutMs2) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs2)
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal })
      const text = await r.text() // 等完整 body——AbortSignal 仍有效，读完才清 timer
      clearTimeout(timer)
      return { response: r, text }
    } catch (e) {
      clearTimeout(timer)
      throw e
    }
  }
  return {
    /** POST JSON：返回 { rttMs（客户端往返，独立）, http, ...响应体（原样，不覆盖）} */
    api: async (path, body, timeoutMs2 = timeoutMs) => {
      const t0 = Date.now()
      try {
        const tk = typeof token === 'function' ? token() : token
      const { response, text } = await fetchWithTimeout(`${baseUrl}${path}${path.includes('?') ? '&' : '?'}token=${tk}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
        }, timeoutMs2)
        let j
        try { j = JSON.parse(text) } catch { j = { error: 'invalid JSON response' } }
        return { rttMs: Date.now() - t0, http: response.status, ...j }
      } catch (e) {
        const isAbort = e.name === 'AbortError'
        return { rttMs: Date.now() - t0, status: 'fetch_error', error: isAbort ? `timeout after ${timeoutMs2}ms` : e.message }
      }
    },
    fetchWithTimeout,
  }
}
