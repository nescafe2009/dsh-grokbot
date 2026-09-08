// 重试记录纯函数回归（node --experimental-strip-types 直接跑 TS 源）
// 覆盖 Codex 十五轮：风险分级（失败31s/成功过期）、重复失败不刷新首次时间
import test from 'node:test'
import assert from 'node:assert/strict'
import { setPendingRetry, getPendingRetry, clearPendingRetry, retryRiskLevel, RETRY_FAILURE_GUARANTEE_MS, RETRY_GUARANTEE_MS } from '../src/client/retry-store.ts'

test('风险分级：30s 内 high（失败缓存最短边界）/ 31s medium / 超 5min low', () => {
  const t0 = Date.now()
  const mk = (age) => ({ conversationId: `c-${age}`, requestId: 'r', text: 'x', taskId: null, createdAt: t0 - age })
  assert.equal(retryRiskLevel(mk(10_000)), 'high')
  assert.equal(retryRiskLevel(mk(RETRY_FAILURE_GUARANTEE_MS + 1_000)), 'medium')   // 失败 31s：不再标 high
  assert.equal(retryRiskLevel(mk(RETRY_GUARANTEE_MS + 1_000)), 'low')             // 成功过期
})

test('重复失败不刷新首次创建时间（不延长保留期）', () => {
  const conv = 'c-refresh'
  clearPendingRetry(conv)
  setPendingRetry({ conversationId: conv, requestId: 'r1', text: 'a', taskId: null, createdAt: Date.now() - 40_000 })
  // 第二次失败（40s 后）：同会话再 set，createdAt 应保留首次
  setPendingRetry({ conversationId: conv, requestId: 'r1', text: 'a', taskId: null, createdAt: Date.now() })
  const got = getPendingRetry(conv)
  assert.ok(Date.now() - got.createdAt >= 39_000, '首次时间未被刷新')
  assert.equal(retryRiskLevel(got), 'medium', '40s 仍是 medium，不被第二次失败拉回 high')
  // 不同请求（新 requestId）失败：用新的首次时间，不继承旧记录
  setPendingRetry({ conversationId: conv, requestId: 'r2', text: 'a', taskId: null, createdAt: Date.now() })
  assert.ok(Date.now() - getPendingRetry(conv).createdAt < 1_000, '新请求失败用新时间')
  clearPendingRetry(conv)
})

test('会话隔离：各会话记录互不串', () => {
  clearPendingRetry('ca'); clearPendingRetry('cb')
  setPendingRetry({ conversationId: 'ca', requestId: 'ra', text: 'A', taskId: 'ta', createdAt: Date.now() })
  setPendingRetry({ conversationId: 'cb', requestId: 'rb', text: 'B', taskId: null, createdAt: Date.now() })
  assert.equal(getPendingRetry('ca').requestId, 'ra')
  assert.equal(getPendingRetry('cb').requestId, 'rb')
  assert.equal(getPendingRetry('cc'), null)
  clearPendingRetry('ca'); clearPendingRetry('cb')
})
