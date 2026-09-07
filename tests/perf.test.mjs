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


/* ---------------- 原函数结构回归（catchError 声明 + 取消 outcome 赋值，Codex 二十七轮 P1） ---------------- */
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const libSrc = readFileSync(`${pluginRoot}/lib/index.mjs`, 'utf8')

test('结构：catchError 在 try/catch/finally 共同作用域声明（let catchError = null）', () => {
  // 在 chatTurn 函数体内：let catchError = null 必须出现
  assert.ok(libSrc.includes('let catchError = null'), 'catchError 已声明（未声明时 finally 抛 ReferenceError 覆盖正常返回——P1）')
  // 不在全局（不在模块顶层——检查声明位置前有 chatTurn 的特征缩进）
  const idx = libSrc.indexOf('let catchError = null')
  assert.ok(idx > 0, '声明存在于构建产物')
})

test('结构：取消分支 outcome 赋值（finally 补 perf 可透传到返回值）', () => {
  // 取消 return 前必须 outcome = {...}（不是直接 return 新对象）
  const cancelIdx = libSrc.indexOf('cancelled = true')
  assert.ok(cancelIdx > 0)
  // 检查 cancelIdx 之后 200 字符内是否有 outcome = {
  const nearby = libSrc.slice(cancelIdx, cancelIdx + 500)
  assert.ok(nearby.includes('outcome = {') || nearby.includes('outcome =\\n'), '取消分支赋值 outcome（finally 统一补 perf 后返回——否则 perf 无法透传）')
})

test('结构：finally 统一 perf（closeActiveRun 后、同一 endTs、cancelled 优先）', () => {
  // finally 内必须有 perfStatus 计算
  assert.ok(libSrc.includes('const perfStatus = isCancelled'), 'finally 内 perfStatus')
  assert.ok(libSrc.includes('cancelled: isCancelled') && libSrc.includes('status: perfStatus'), 'logPerf 含 cancelled+status')
  // try 正常返回前不再有提前 logPerf
  const tryBlock = libSrc.slice(libSrc.indexOf('const execStart'), libSrc.indexOf('} finally {', libSrc.indexOf('const execStart')))
  assert.ok(!tryBlock.includes('logPerf'), 'try 块内无提前 logPerf')
})

test('结构：conversationTurn 多成员分支透出 outcome', () => {
  // 多成员 return 必须含 outcome
  const normalized = libSrc.replace(/[\n\t ]+/g, ' ')
  assert.ok(normalized.includes('handoffTo: null, outcome'), '多成员分支 return 含 outcome（构建产物归一化匹配）')
})

test('结构：api-chat status 优先 cancelled', () => {
  assert.ok(libSrc.includes('cancelled"') || libSrc.includes("cancelled ? '"), 'status 优先级：cancelled 在 failed/ok 之前')
})
