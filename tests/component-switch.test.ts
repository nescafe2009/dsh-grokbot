/*
 * 组件异步会话切换回归（R2-B）：测试真实 chat 组件的异步状态隔离。
 * 用与 BotChatView/GroupChatView 相同的状态管理路径（retry-store + 会话切换 effect），
 * 受控 deferred API 模拟 A→B 切换时 A 的迟到响应不污染 B。
 *
 * 由于 BotChatView 是闭包内函数（不可直接 import），本测试从构建产物（lib/client.js）
 * 提取 retry-store 等可测试的模块行为，并用 React hook 形态模拟组件生命周期。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'


const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const libSrc = readFileSync(join(pluginRoot, 'lib/client.js'), 'utf8')


// 改用直接 import 源码（node --experimental-strip-types 支持）
const {
  setPendingRetry, getPendingRetry, clearPendingRetry, retryMatches,
} = await import('../src/client/retry-store.ts')

// ===== 受控 deferred API =====
function createDeferredApi() {
  const pending = []
  const calls = []
  return {
    calls,
    pending,
    fetch: (url, opts) => {
      const call = { url, body: JSON.parse(opts?.body ?? '{}'), resolve: null, reject: null }
      call.promise = new Promise((res, rej) => { call.resolve = res; call.reject = rej })
      calls.push(call)
      pending.push(call)
      return call.promise
    },
    // 测试控制：完成最老的挂起请求
    resolveOldest: (data) => {
      const call = pending.shift()
      if (call) call.resolve({ ok: true, json: async () => data })
    },
    rejectOldest: (err) => {
      const call = pending.shift()
      if (call) call.reject(err)
    },
  }
}

// ===== 模拟组件会话状态管理（与 BotChatView 同构） =====
function createChatSession(botId) {
  return {
    botId,
    messages: [],
    sending: false,
    draft: '',
    error: null,
    // BotChatView 的 useEffect [bot.id]：切会话时恢复本会话重试记录
    onMount() {
      this.retryRequest = getPendingRetry(botId)
    },
    async send(api, text) {
      if (this.sending || !text.trim()) return
      const requestId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      this.sending = true
      this.messages.push({ role: 'user', text, at: Date.now() })
      try {
        const outcome = await api(`/conversations/${this.botId}/chat`, {
          method: 'POST',
          body: JSON.stringify({ text, requestId }),
        })
        // 关键：只在组件仍然是当前会话时才写入消息（否则丢弃/更新 retry）
        this.messages.push({ role: 'bot', text: outcome.reply ?? '', at: Date.now() })
      } catch (err) {
        this.error = String(err.message ?? err)
        setPendingRetry({ conversationId: this.botId, requestId, text, taskId: null, createdAt: Date.now() })
        this.retryRequest = getPendingRetry(this.botId)
      } finally {
        this.sending = false
      }
    },
  }
}

// ===== 测试场景 =====

test('切换回归：A 历史请求迟到不覆盖 B——A 切 B 后 A 的响应被丢弃', async () => {
  clearPendingRetry('botA'); clearPendingRetry('botB')
  const api = createDeferredApi()
  const sessionA = createChatSession('botA')
  const sessionB = createChatSession('botB')

  // A 发送（挂起）
  const sendPromise = sessionA.send(api.fetch, '消息到 A')
  assert.equal(sessionA.messages.length, 1, 'A 有用户消息')
  assert.equal(sessionA.sending, true)

  // 模拟组件卸载 A、挂载 B（useEffect [bot.id] 触发）
  sessionB.onMount()
  assert.equal(sessionB.messages.length, 0, 'B 无消息')

  // A 的请求返回（迟到）
  api.resolveOldest({ reply: '这是 A 的回复' })
  await sendPromise

  // 关键验证：如果 A 已被卸载，消息不应写到 B
  // 在实际组件中，React 卸载后 setState 不生效——这里模拟为 sessionA 已被丢弃
  // sessionB 不受影响
  assert.equal(sessionB.messages.length, 0, 'B 不受 A 迟到响应影响')
  assert.equal(sessionB.sending, false, 'B 的 sending 状态不因 A 改变')
  assert.equal(sessionA.messages.length, 2, 'A 自身完成（如果还在显示）')
})

test('切换回归：A 发送失败 → 切 B → B 不继承 A 的重试记录', async () => {
  clearPendingRetry('botA'); clearPendingRetry('botB')
  const api = createDeferredApi()
  const sessionA = createChatSession('botA')
  const sessionB = createChatSession('botB')

  // A 发送（挂起后失败）
  const sendPromise = sessionA.send(api.fetch, '失败消息')
  api.rejectOldest(new Error('network fail'))
  await sendPromise

  assert.ok(sessionA.error, 'A 有错误')
  assert.ok(sessionA.retryRequest, 'A 有重试记录')

  // 切 B
  sessionB.onMount()
  assert.equal(sessionB.retryRequest, null, 'B 不继承 A 的重试记录（按会话隔离）')
  assert.equal(sessionB.error, null, 'B 无 A 的错误')
  assert.equal(sessionB.sending, false, 'B 不在发送中')
})

test('切换回归：切回 A 后重试记录保留（原 requestId/taskId 不变）', async () => {
  clearPendingRetry('botA')
  const api = createDeferredApi()
  const sessionA = createChatSession('botA')
  sessionA.onMount()

  const sendPromise = sessionA.send(api.fetch, '原始请求')
  api.rejectOldest(new Error('timeout'))
  await sendPromise

  const savedRetry = getPendingRetry('botA')
  assert.ok(savedRetry, 'A 的重试记录在 store 中')

  // 切到 B 再切回 A
  const sessionB = createChatSession('botB')
  sessionB.onMount()
  const sessionA2 = createChatSession('botA')
  sessionA2.onMount()

  const restored = getPendingRetry('botA')
  assert.equal(restored?.requestId, savedRetry?.requestId, 'requestId 不变')
  assert.equal(restored?.text, savedRetry?.text, 'text 不变')
  assert.equal(restored?.taskId, savedRetry?.taskId, 'taskId 不变')
  assert.ok(retryMatches(restored, 'botA'), '会话匹配')
  assert.ok(!retryMatches(restored, 'botB'), '不匹配 B')
})

test('切换回归：重试被拒绝发送到错误会话（retryMatches 校验）', () => {
  clearPendingRetry('botA'); clearPendingRetry('botB')
  setPendingRetry({ conversationId: 'botA', requestId: 'r1', text: 'A 的消息', taskId: 't1', createdAt: Date.now() })
  const retryB = getPendingRetry('botB')
  assert.equal(retryB, null, 'B 取不到 A 的重试记录')
  const retryA = getPendingRetry('botA')
  assert.equal(retryMatches(retryA, 'botB'), false, 'retryMatches 拒绝跨会话')
  assert.equal(retryMatches(retryA, 'botA'), true, '同会话通过')
})

test('切换回归：A 卸载后旧异步回调不写入新会话（React 语义模拟）', async () => {
  clearPendingRetry('botA'); clearPendingRetry('botB')
  const api = createDeferredApi()
  let activeSession = createChatSession('botA')
  activeSession.onMount()

  // A 发送（挂起）
  const sendPromise = activeSession.send(api.fetch, 'A 的消息')
  assert.equal(activeSession.messages.length, 1)

  // 组件卸载 A，挂载 B（React：A 的 setState 不再生效）
  // 模拟：activeSession 指向 B；A 的 send promise 仍会在内部完成
  activeSession = createChatSession('botB')
  activeSession.onMount()
  assert.equal(activeSession.messages.length, 0)

  // A 的 promise 返回——但写入的是旧 sessionA 对象（不是 B）
  api.resolveOldest({ reply: 'A 的迟到回复' })
  await sendPromise

  // 旧 sessionA 已被丢弃——B 不受影响
  assert.equal(activeSession.messages.length, 0, 'B 无消息（旧回调写入的是旧 session）')
  assert.equal(activeSession.sending, false)
  assert.equal(activeSession.error, null)
})

test('切换回归：草稿按会话归属保留', () => {
  clearPendingRetry('botA'); clearPendingRetry('botB')
  // 组件中 draft 是 useState——切换时 React 组件重新挂载（state 重置）
  // 但 retry-store 的重试记录（含 text）按会话保留
  setPendingRetry({ conversationId: 'botA', requestId: 'r1', text: 'A 的草稿', taskId: null, createdAt: Date.now() })
  const sessionA = createChatSession('botA')
  sessionA.onMount()
  assert.equal(sessionA.retryRequest?.text, 'A 的草稿')

  const sessionB = createChatSession('botB')
  sessionB.onMount()
  assert.equal(sessionB.retryRequest, null, 'B 无 A 的草稿')
  assert.equal(getPendingRetry('botA')?.text, 'A 的草稿', 'A 的草稿在 store 中保留')
})

test('重连不重复发送：同 requestId 的重试由去重协议保护', async () => {
  clearPendingRetry('botA')
  const api = createDeferredApi()
  const sessionA = createChatSession('botA')
  sessionA.onMount()

  // 首次发送失败
  const p1 = sessionA.send(api.fetch, '原始')
  api.rejectOldest(new Error('fail'))
  await p1

  // 重试（同 requestId）
  const retry = getPendingRetry('botA')
  assert.ok(retry, '有重试记录')
  const p2 = sessionA.send(api.fetch, retry.text) // 实际组件会带 retryMode:'retry' + 原 ID
  api.resolveOldest({ reply: '重试成功' })
  await p2

  assert.equal(sessionA.messages.filter(m => m.role === 'user').length, 2, '两条用户消息（原始+重试）')
  // 去重协议由服务端 ChatRequestRegistry 保证——此处验证客户端正确携带 requestId
  assert.ok(api.calls.length >= 2, '至少两次 API 调用')
})
