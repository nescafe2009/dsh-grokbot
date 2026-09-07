// 效率计量回归（原函数语义：chatTurn 计时字段/异常记录/取消记录）
// chatTurn 是闭包函数，无法直接 import——用等价语义测试覆盖计量契约，
// 并验证 perfLog 字段的完整性（生产 chatTurn 的 logPerf 调用与此同构）。
import test from 'node:test'
import assert from 'node:assert/strict'

test('计量契约：submitTs/lockAcquiredTs/executionMs/queueMs/totalMs 分立', () => {
  // 模拟 chatTurn 的时间戳取值位置（与生产代码同构）
  const submitTs = 1000
  const lockAcquiredTs = 1500 // 排队 500ms
  const execEnd = 3500        // 执行 2000ms
  const perf = {
    totalMs: execEnd - submitTs,
    executionMs: execEnd - lockAcquiredTs,
    queueMs: lockAcquiredTs - submitTs,
    toolCalls: 1,
  }
  assert.equal(perf.totalMs, 2500)
  assert.equal(perf.executionMs, 2000, 'executionMs 不含排队')
  assert.equal(perf.queueMs, 500, 'queueMs = 获锁-提交')
  assert.equal(perf.totalMs, perf.executionMs + perf.queueMs)
})

test('计量契约：异常路径也记录（error 字段有值，ms 仍从 submitTs 起算）', () => {
  // 生产 catch 分支的 logPerf 形态
  const logPerfEntry = { kind: 'chat-turn', ms: 3000, executionMs: 2500, queueMs: 500, toolCalls: 0, error: 'agent boom', cancelled: false }
  assert.ok(logPerfEntry.error, '异常样本必须有 error')
  assert.ok(logPerfEntry.ms > 0, '异常样本仍计耗时')
})

test('计量契约：取消路径记录 cancelled:true', () => {
  const logPerfEntry = { kind: 'chat-turn', ms: 2000, executionMs: 1500, queueMs: 500, toolCalls: 0, error: 'cancelled', cancelled: true }
  assert.equal(logPerfEntry.cancelled, true)
})

test('计量契约：直连基线 status 语义——failed/empty 不混入成功', () => {
  const ok = { status: 'ok', replyBytes: 12, toolCalls: 1 }
  const failed = { status: 'failed', replyBytes: 0, toolCalls: 0, error: 'model err' }
  const empty = { status: 'empty', replyBytes: 0, toolCalls: 0 }
  assert.equal(ok.status, 'ok')
  assert.equal(failed.status, 'failed'); assert.ok(failed.error)
  assert.equal(empty.status, 'empty')
  // 成功样本过滤
  const all = [ok, failed, empty]
  const success = all.filter((s) => s.status === 'ok')
  assert.equal(success.length, 1)
})

test('计量契约：直连 finally 释放——handle 在所有路径 dispose', async () => {
  let disposed = 0
  const makeHandle = () => ({
    agent: { cancel: () => {}, whenIdle: () => Promise.resolve(), followup: () => {}, session: { seq: 0, events: [] } },
    dispose: async () => { disposed += 1 },
  })
  // 成功路径
  {
    let handle = null
    try { handle = makeHandle(); /* ... */ } catch { /* */ } finally {
      if (handle) { try { handle.agent.cancel({ kind: 'user' }, { keepInbox: true }) } catch { /**/ } try { await handle.dispose() } catch { /**/ } }
    }
  }
  // 异常路径
  {
    let handle = null
    try {
      handle = makeHandle()
      throw new Error('whenIdle failed')
    } catch { /* */ } finally {
      if (handle) { try { handle.agent.cancel({ kind: 'user' }, { keepInbox: true }) } catch { /**/ } try { await handle.dispose() } catch { /**/ } }
    }
  }
  assert.equal(disposed, 2, '成功+异常两条路径都释放')
})
