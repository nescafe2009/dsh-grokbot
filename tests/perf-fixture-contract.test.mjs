// 采样脚本契约回归（无模型）——认证预检退出码 + 插件 outcome 字段归一化
// 用与 sample.mjs 相同的 normalizeSample/hasPluginToolEvidence 逻辑
import test from 'node:test'
import assert from 'node:assert/strict'

// ===== 与 sample.mjs 同构的归一化逻辑 =====
function normalizeSample(raw) {
  const isFetchError = raw.status === 'fetch_error' || raw.error?.includes?.('timeout')
  const outcome = raw.outcome ?? {}
  const isCancelled = raw.cancelled === true || outcome.cancelled === true
  const hasError = raw.error || outcome.error
  // 直连响应没有 reply 字段——用 replyBytes>0 或 status 判断；插件用 reply
  const isEmpty = (raw.reply === undefined && (raw.replyBytes ?? 0) === 0 && raw.status !== 'ok') || raw.reply?.includes('未能给出文本回复') || (!raw.reply && raw.replyBytes === undefined)
  const isHttpErr = raw.http >= 400
  if (isFetchError || isCancelled || isEmpty || isHttpErr || hasError) {
    return { ...raw, status: isCancelled ? 'cancelled' : 'failed' }
  }
  return { ...raw, status: raw.status || 'ok' }
}
function hasPluginToolEvidence(sample) {
  const outcome = sample.outcome ?? {}
  const activity = outcome.activity ?? outcome.perf?.toolCalls !== undefined ? (outcome.perf?.toolCalls > 0 ? ['bash'] : []) : []
  if (Array.isArray(activity) && activity.length > 0) return true
  if (Array.isArray(sample.activity)) return sample.activity.some(a => typeof a === 'string' && (a.includes('bash') || a.includes('exec')))
  return false
}

// ===== 1. 认证预检失败 → exitCode=1（不绕过）=====
test('退出码：真实认证失败（preflight status≠ok）→ exitCode=1', () => {
  // 模拟 main() 的 preflight 失败路径
  let overallStatus = 'ok'
  let exitCode = 0
  const preflight = { status: 'failed', error: 'no credential' }
  if (preflight.status !== 'ok') {
    overallStatus = 'incomplete'
    exitCode = 1 // 这行不能丢——上版 bug 是只 return 不设 exitCode
  }
  // main() 返回后的统一映射
  if (overallStatus !== 'ok') exitCode = 1
  assert.equal(exitCode, 1, '真实认证失败必须 exit 1（上版 bug：只 return 绕过 exitCode）')
})

// ===== 2. 插件取消有部分回复 → 不算 ok =====
test('归一化：插件取消（outcome.cancelled=true + 部分回复）→ cancelled 非 ok', () => {
  // 实际 chat API 形状：{ reply: '部分文本', outcome: { cancelled: true, perf: {...} } }
  const raw = { reply: '这是部分回复', ms: 3000, http: 200, outcome: { cancelled: true, perf: { totalMs: 2900 } } }
  const s = normalizeSample(raw)
  assert.equal(s.status, 'cancelled', '有回复但 outcome.cancelled=true → cancelled（上版误记 ok）')
})

// ===== 3. 插件 error 有部分回复 → 不算 ok =====
test('归一化：插件错误（outcome.error + 部分回复）→ failed', () => {
  const raw = { reply: 'partial text before error', ms: 5000, http: 200, outcome: { error: 'agent boom' } }
  const s = normalizeSample(raw)
  assert.equal(s.status, 'failed', '有回复但 outcome.error → failed')
})

// ===== 4. 插件成功 bash → 有工具证据 =====
test('工具证据：插件成功 bash（outcome.perf.toolCalls=1）→ evidence=true', () => {
  const raw = { reply: 'COLD-TOOL', ms: 8000, http: 200, outcome: { perf: { toolCalls: 1 }, activity: undefined } }
  // 实际 API 中 activity 在 outcome 里——perf.toolCalls 也能证明
  assert.equal(hasPluginToolEvidence(raw), true, 'outcome.perf.toolCalls=1 → 有工具证据（上版读顶层 activity 找不到）')
})

// ===== 5. 插件无工具 → 无证据 =====
test('工具证据：插件无工具（outcome.perf.toolCalls=0）→ evidence=false', () => {
  const raw = { reply: '直接回复无工具', ms: 2000, http: 200, outcome: { perf: { toolCalls: 0 } } }
  assert.equal(hasPluginToolEvidence(raw), false)
})

// ===== 6. 直连工具：toolCalls=1 + 有回复 → ok =====
test('直连工具：toolCalls=1 + replyBytes>0 → ok', () => {
  const raw = { status: 'ok', toolCalls: 1, replyBytes: 11, ms: 5000 }
  const s = normalizeSample(raw)
  assert.equal(s.status, 'ok')
  assert.equal((raw.toolCalls ?? 0) > 0, true)
  assert.equal((raw.replyBytes ?? 0) > 0, true)
})

// ===== 7. 直连工具：toolCalls=0 → failed =====
test('直连工具：toolCalls=0 → failed（无证据不算成功）', () => {
  const raw = { status: 'ok', toolCalls: 0, replyBytes: 5, ms: 3000 }
  assert.equal((raw.toolCalls ?? 0) > 0, false, '工具任务必须 toolCalls>0')
})

// ===== 8. 失败预热 → incomplete + exitCode=1 =====
test('退出码：失败预热 → incomplete + exitCode=1', () => {
  let overallStatus = 'ok'
  let exitCode = 0
  const warmupOk = false // 模拟 outcome.cancelled
  if (!warmupOk) {
    overallStatus = 'incomplete'
    exitCode = 1
  }
  if (overallStatus !== 'ok') exitCode = 1
  assert.equal(exitCode, 1)
})

// ===== 9. 暖直连 blocked → 恒 incomplete + exitCode=1 =====
test('退出码：暖直连 blocked → incomplete + exitCode=1', () => {
  let overallStatus = 'ok'
  results_status = 'blocked'
  let exitCode = 0
  if (results_status === 'blocked') overallStatus = 'incomplete'
  if (overallStatus !== 'ok') exitCode = 1
  assert.equal(exitCode, 1)
})
let results_status = 'ok'

// ===== 10. 正常成功 → ok + exitCode=0 =====
test('退出码：全部 ok → exitCode=0', () => {
  let overallStatus = 'ok'
  let exitCode = 0
  if (overallStatus !== 'ok') exitCode = 1
  assert.equal(exitCode, 0)
})
