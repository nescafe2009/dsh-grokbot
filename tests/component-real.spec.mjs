
// 设置 DOM 环境（happy-dom）
import { Window } from '/tmp/react-test-env/node_modules/happy-dom/lib/index.js'
const win = new Window()
globalThis.document = win.document
globalThis.window = win
Object.defineProperty(globalThis, 'navigator', { value: win.navigator, writable: true, configurable: true })
globalThis.HTMLElement = win.HTMLElement
globalThis.HTMLTextAreaElement = win.HTMLTextAreaElement
globalThis.Event = win.Event
globalThis.MutationObserver = class { observe() {} disconnect() {} }

// 真实组件异步会话切换回归：用 React DOM 挂载 BotChatView/GroupChatView
// 运行真实组件代码（非复写），mock globalThis.fetch + deferred 响应
import test from 'node:test'
import assert from 'node:assert/strict'

// 导入真实组件（构建产物 ESM + react symlink）
const { BotChatView, GroupChatView } = await import('/tmp/ctb/test-entry.mjs')
const React = await import('/tmp/react-test-env/node_modules/react/index.js')
const { createRoot } = await import('/tmp/react-test-env/node_modules/react-dom/client.js')
const { act } = await import('/tmp/react-test-env/node_modules/react-dom/test-utils.js')

// ===== Mock fetch + deferred =====
let fetchCalls = []
let deferredQueue = []
const originalFetch = globalThis.fetch

function setupMockFetch() {
  fetchCalls = []
  deferredQueue = []
  globalThis.fetch = (url, opts) => {
    const call = { url, method: opts?.method ?? 'GET', body: opts?.body }
    fetchCalls.push(call)
    return new Promise((resolve, reject) => {
      deferredQueue.push({ call, resolve, reject })
    })
  }
}
function teardownMockFetch() {
  globalThis.fetch = originalFetch
}
async function resolveLatest(data, raw) {
  const d = deferredQueue.shift()
  if (!d) throw new Error('no pending fetch')
  d.resolve(raw ?? {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  })
}
// 精确选择：按 URL 子串 + method 找请求（避免 shift 到历史 GET）
function resolveFor(urlSubstr, method, data) {
  const idx = deferredQueue.findIndex(d => d.call.url.includes(urlSubstr) && d.call.method === method)
  assert.ok(idx >= 0, `no pending ${method} ${urlSubstr} in queue of ${deferredQueue.length}`)
  const d = deferredQueue.splice(idx, 1)[0]
  d.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) })
  return d
}
function rejectFor(urlSubstr, method, err) {
  const idx = deferredQueue.findIndex(d => d.call.url.includes(urlSubstr) && d.call.method === method)
  if (idx < 0) throw new Error(`no pending ${method} ${urlSubstr}`)
  const d = deferredQueue.splice(idx, 1)[0]
  d.reject(err ?? new Error('mock network fail'))
}
function rejectLatest(err) {
  const d = deferredQueue.shift()
  if (!d) throw new Error('no pending fetch')
  d.reject(err ?? new Error('mock network fail'))
}

// ===== Render helper =====
function makeBot(id, name = id) {
  return { id, name, avatar: '🤖', title: '', pinned: false, section: '', hidden: false, status: 'idle', currentJob: null, lastActivity: null, rating: null }
}
function makeConv(id, members = ['botA']) {
  return { id, name: id, memberBotIds: members, isGroup: members.length > 1 }
}

function createContainer() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return { el, root: createRoot(el) }
}

async function render(reactEl, container) {
  await act(async () => {
    container.root.render(reactEl)
  })
}

async function rerender(reactEl, container) {
  await act(async () => {
    container.root.render(reactEl)
  })
}

// ===== 1. DM→DM 切换：A 发送中切 B，A 迟到响应不写入 B =====
test('真实组件 DM→DM：A 发送中切 B → A 迟到不污染 B', async () => {
  setupMockFetch()
  const c = createContainer()
  const botA = makeBot('botA', 'A')
  const botB = makeBot('botB', 'B')

  // 挂载 A
  await render(React.createElement(BotChatView, { bot: botA, state: null }), c)

  // 在 A 中发送（fetch 挂起）
  const textarea = c.el.querySelector('textarea')
  assert.ok(textarea, 'composer textarea exists')
  await act(async () => {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    nativeSetter.call(textarea, '消息到 A')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const sendBtn = [...c.el.querySelectorAll('button')].find(b => b.textContent?.includes('↑'))
  assert.ok(sendBtn, 'send button exists')

  // 点击发送 → fetch 挂起（deferred 不 resolve）
  await act(async () => { sendBtn.click() })
  assert.equal(fetchCalls.filter(f => f.url.includes('/chat')).length, 1, 'A 发起了 chat 请求')

  // 切换到 B（同一父级——React 同位置 re-render，组件 state 复用）
  await rerender(React.createElement(BotChatView, { bot: botB, state: null }), c)

  // A 的 chat POST 现在返回（精确选择，不误 resolve 历史 GET）
  await act(async () => {
    await resolveFor('/botA/chat', 'POST', { reply: '这是 A 的迟到回复' })
  })

  // 验证：B 的消息流不应包含 A 的回复
  const messages = c.el.querySelectorAll('.gkf-msg')
  const allText = [...messages].map(m => m.textContent).join('|')
  assert.ok(!allText.includes('这是 A 的迟到回复'), `A 的迟到回复不应出现在 B（实际: ${allText.slice(0,100)}）`)

  // B 可以正常发送（sending 状态不被 A 阻塞）
  const bTextarea = c.el.querySelector('textarea')
  await act(async () => {
    const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    s.call(bTextarea, 'B 的消息')
    bTextarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const bSend = [...c.el.querySelectorAll('button')].find(b => b.textContent?.includes('↑'))
  assert.ok(!bSend?.disabled, 'B 的发送按钮未被 A 阻塞')

  c.root.unmount()
  c.el.remove()
  teardownMockFetch()
})

// ===== 2. DM→DM：A 失败切 B → B 无错误 =====
test('真实组件 DM→DM：A 发送失败 → B 无错误/重试条', async () => {
  setupMockFetch()
  const c = createContainer()
  await render(React.createElement(BotChatView, { bot: makeBot('botA'), state: null }), c)

  const textarea = c.el.querySelector('textarea')
  await act(async () => {
    const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    s.call(textarea, '失败消息')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const sendBtn = [...c.el.querySelectorAll('button')].find(b => b.textContent?.includes('↑'))
  await act(async () => { sendBtn.click() })

  // A 的请求失败
  await act(async () => { rejectLatest() })

  // 切 B
  await rerender(React.createElement(BotChatView, { bot: makeBot('botB'), state: null }), c)

  // B 不应显示 A 的错误消息
  const allText = c.el.textContent
  assert.ok(!allText.includes('mock network fail'), 'B 不显示 A 的错误消息（mock network fail）')
  assert.ok(!allText.includes('发送失败'), 'B 不显示发送失败提示')

  // B 不应有 A 的重试条（retryRequest 按会话隔离）
  const retryBtn = [...c.el.querySelectorAll('button')].find(b => b.textContent?.includes('重试'))
  assert.ok(!retryBtn, 'B 不显示 A 的重试按钮')

  c.root.unmount()
  c.el.remove()
  teardownMockFetch()
})

// ===== 3. DM→DM→DM：切回 A 后重试记录保留 =====
test('真实组件 DM→DM→DM：切回 A 重试记录保留', async () => {
  setupMockFetch()
  const c = createContainer()
  const botA = makeBot('botA', 'A')
  await render(React.createElement(BotChatView, { bot: botA, state: null }), c)

  // A 发送失败
  const ta = c.el.querySelector('textarea')
  await act(async () => {
    const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    s.call(ta, 'A 要重试的消息')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const btn = [...c.el.querySelectorAll('button')].find(b => b.textContent?.includes('↑'))
  await act(async () => { btn.click() })
  await act(async () => { rejectLatest() })

  // 切 B 再切回 A
  await rerender(React.createElement(BotChatView, { bot: makeBot('botB'), state: null }), c)
  await rerender(React.createElement(BotChatView, { bot: botA, state: null }), c)

  // A 应有重试条
  const retryBtn = [...c.el.querySelectorAll('button')].find(b => b.textContent?.includes('重试'))
  assert.ok(retryBtn, '切回 A 后重试条恢复')

  c.root.unmount()
  c.el.remove()
  teardownMockFetch()
})

// ===== 4. Group→Group：A 历史迟到不覆盖 B =====
test('真实组件 群→群：A 历史迟到不覆盖 B', async () => {
  setupMockFetch()
  const c = createContainer()
  const convA = makeConv('groupA', ['botA', 'botB'])
  const convB = makeConv('groupB', ['botC'])

  const botsA = [makeBot('botA'), makeBot('botB')]
  const botsB = [makeBot('botC')]

  // 挂载群 A → 触发历史 fetch（挂起）
  await render(React.createElement(GroupChatView, { conversation: convA, bots: botsA }), c)

  // 群 A 有历史请求挂起（messages fetch poll）
  const aFetchCount = fetchCalls.length
  assert.ok(aFetchCount >= 0, 'A mounted')

  // 切群 B
  await rerender(React.createElement(GroupChatView, { conversation: convB, bots: botsB }), c)

  // A 的历史请求返回
  await act(async () => {
    for (let i = 0; i < aFetchCount; i++) {
      await resolveLatest({ messages: [{ ts: Date.now(), role: 'bot', botId: 'botA', text: 'A 群的历史消息' }] })
    }
  })

  // B 不应显示 A 群的消息
  const allText = c.el.textContent ?? ''
  assert.ok(!allText.includes('A 群的历史消息'), 'B 不显示 A 群的历史')

  c.root.unmount()
  c.el.remove()
  teardownMockFetch()
})

// ===== 5. 重连不重复发送（重试带原 requestId）=====
test('真实组件：重试按钮复用原 requestId', async () => {
  setupMockFetch()
  const c = createContainer()
  const botA = makeBot('botA', 'A')
  await render(React.createElement(BotChatView, { bot: botA, state: null }), c)

  // 发送失败
  const ta = c.el.querySelector('textarea')
  await act(async () => {
    const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    s.call(ta, '要重试的消息')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const btn = [...c.el.querySelectorAll('button')].find(b => b.textContent?.includes('↑'))
  await act(async () => { btn.click() })
  await act(async () => { rejectLatest() })

  // 找到重试按钮并点击
  const retryBtn = [...c.el.querySelectorAll('button')].find(b => b.textContent?.includes('重试'))
  assert.ok(retryBtn, '有重试按钮')

  const firstChat = fetchCalls.find(f => f.url.includes('/chat'))
  assert.ok(firstChat, '第一次 chat 调用存在')
  const firstBody = JSON.parse(firstChat.body)
  assert.ok(firstBody.requestId, '第一次有 requestId')

  // 点击重试 → 第二次 chat 调用
  await act(async () => { retryBtn.click() })
  const chatCalls = fetchCalls.filter(f => f.url.includes('/chat'))
  assert.equal(chatCalls.length, 2, '重试发起第二次请求')
  const secondBody = JSON.parse(chatCalls[1].body)
  assert.equal(secondBody.requestId, firstBody.requestId, `重试复用原 requestId（${firstBody.requestId}）`)
  assert.equal(secondBody.retryMode, 'retry', '带 retryMode=retry')

  c.root.unmount()
  c.el.remove()
  teardownMockFetch()
})


// ===== 6. Codex 探针：A 未发送草稿切 B → B 不继承 =====
test('真实组件 DM：A 未发送草稿 → 切 B → B 草稿为空（切回 A 恢复）', async () => {
  setupMockFetch()
  const c = createContainer()
  const botA = makeBot('draftA', 'A')
  await render(React.createElement(BotChatView, { bot: botA, state: null }), c)
  const ta = c.el.querySelector('textarea')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'A PRIVATE DRAFT')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  assert.equal(ta.value, 'A PRIVATE DRAFT')

  // 切 B
  await rerender(React.createElement(BotChatView, { bot: makeBot('draftB'), state: null }), c)
  assert.equal(c.el.querySelector('textarea').value, '', 'B 不继承 A 的草稿')

  // 切回 A → 草稿恢复
  await rerender(React.createElement(BotChatView, { bot: botA, state: null }), c)
  assert.equal(c.el.querySelector('textarea').value, 'A PRIVATE DRAFT', '切回 A 恢复草稿')

  c.root.unmount(); c.el.remove(); teardownMockFetch()
})

// ===== 7. Codex 探针：群 A POST 迟到不覆盖 B =====
test('真实组件 群→群：A POST 迟到不覆盖群 B', async () => {
  setupMockFetch(); const c = createContainer()
  const bots = [makeBot('ga'), makeBot('gb')]
  await render(React.createElement(GroupChatView, { conversation: makeConv('lateA', ['ga','gb']), bots }), c)
  const ta = c.el.querySelector('textarea')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'A work')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    [...c.el.querySelectorAll('button')].find(b => b.textContent.includes('↑')).click()
  })
  // 精确找到 lateA 的 POST
  const idx = deferredQueue.findIndex(d => d.call.url.includes('/lateA/chat') && d.call.method === 'POST')
  assert.ok(idx >= 0, 'lateA chat POST pending')

  // 切 lateB
  await rerender(React.createElement(GroupChatView, { conversation: makeConv('lateB', ['ga','gb']), bots }), c)

  // A 的 POST 返回
  await act(async () => {
    const d = deferredQueue.splice(idx, 1)[0]
    d.resolve({ ok: true, status: 200, json: async () => ({ messages: [{ ts: 1, role: 'bot', botId: 'ga', text: 'A_ONLY_LATE_RESULT' }] }) })
  })
  assert.ok(!c.el.textContent.includes('A_ONLY_LATE_RESULT'), 'B 不显示 A 的迟到结果')

  c.root.unmount(); c.el.remove(); teardownMockFetch()
})

// ===== 8. A 发送 → B 发送 → A 迟到完成/失败 → B 不受影响 =====
test('真实组件 DM：A 发送中 B 也发送 → A 迟到完成 → B 状态不受影响', async () => {
  setupMockFetch(); const c = createContainer()
  const botA = makeBot('multiA', 'A')
  const botB = makeBot('multiB', 'B')

  // A 发送
  await render(React.createElement(BotChatView, { bot: botA, state: null }), c)
  let ta = c.el.querySelector('textarea')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'A msg')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { [...c.el.querySelectorAll('button')].find(b => b.textContent.includes('↑')).click() })

  // 切 B → B 也发送
  await rerender(React.createElement(BotChatView, { bot: botB, state: null }), c)
  ta = c.el.querySelector('textarea')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'B msg')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const bBtn = [...c.el.querySelectorAll('button')].find(b => b.textContent.includes('↑'))
  assert.ok(!bBtn.disabled, 'B 可发送（不被 A 阻塞）')
  await act(async () => { bBtn.click() })

  // A 的 POST 迟到完成
  await act(async () => {
    await resolveFor('/multiA/chat', 'POST', { reply: 'A late reply' })
  })

  // B 的消息流不含 A 的回复
  assert.ok(!c.el.textContent.includes('A late reply'), 'B 不显示 A 迟到回复')

  // B 的 POST 正常完成——resolve POST + 后续 history GET（BotChatView send 内 await refetchHistory）
  await act(async () => {
    await resolveFor('/multiB/chat', 'POST', { reply: 'B reply' })
    // refetchHistory 的 GET 也需要 resolve（否则组件卡在 await）
    const histIdx = deferredQueue.findIndex(d => d.call.url.includes('/multiB') && d.call.method === 'GET')
    if (histIdx >= 0) {
      const hd = deferredQueue.splice(histIdx, 1)[0]
      hd.resolve({ ok: true, status: 200, json: async () => ({ messages: [{ ts: Date.now(), role: 'user', text: 'B msg' }, { ts: Date.now(), role: 'bot', text: 'B reply' }] }), text: async () => '{}' })
    }
  })
  // Give component a tick to flush
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  assert.ok(c.el.textContent.includes('B reply'), 'B 显示自己的回复')

  c.root.unmount(); c.el.remove(); teardownMockFetch()
})

// ===== 9. A→B→A：A 的旧回调不覆盖新一轮状态 =====
test('真实组件 DM：A→B→A 后 A 旧回调不覆盖新一轮', async () => {
  setupMockFetch(); const c = createContainer()
  const botA = makeBot('cycleA', 'A')
  await render(React.createElement(BotChatView, { bot: botA, state: null }), c)
  let ta = c.el.querySelector('textarea')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, '第一轮消息')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { [...c.el.querySelectorAll('button')].find(b => b.textContent.includes('↑')).click() })
  const firstPostIdx = deferredQueue.findIndex(d => d.call.url.includes('/cycleA/chat') && d.call.method === 'POST')

  // 切 B 再切回 A
  await rerender(React.createElement(BotChatView, { bot: makeBot('cycleB'), state: null }), c)
  await rerender(React.createElement(BotChatView, { bot: botA, state: null }), c)

  // A 第一轮的 POST 迟到完成
  await act(async () => {
    const d = deferredQueue.splice(firstPostIdx, 1)[0]
    d.resolve({ ok: true, status: 200, json: async () => ({ reply: '第一轮迟到回复' }) })
  })

  // A 可以发送第二轮
  ta = c.el.querySelector('textarea')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, '第二轮消息')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const btn2 = [...c.el.querySelectorAll('button')].find(b => b.textContent.includes('↑'))
  assert.ok(!btn2?.disabled, '切回 A 后可发送新消息（旧回调不阻塞）')

  c.root.unmount(); c.el.remove(); teardownMockFetch()
})


// ===== 10. Codex 探针：离开 A 后失败 → 切回 A 重试记录保留 =====
test('Codex: late failure preserves original conversation retry', async () => {
  setupMockFetch(); const c = createContainer(); const a = makeBot('retryLateA')
  try {
    await render(React.createElement(BotChatView, { bot: a, state: null }), c)
    const ta = c.el.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'must retain')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => [...c.el.querySelectorAll('button')].find(b => b.textContent.includes('↑')).click())
    const post = deferredQueue.find(d => d.call.url.includes('/retryLateA/chat'))
    assert.ok(post, 'retryLateA POST pending')

    // 切 B → A 的 POST 失败 → 切回 A
    await rerender(React.createElement(BotChatView, { bot: makeBot('retryLateB'), state: null }), c)
    await act(async () => post.reject(new Error('late network failure')))
    await rerender(React.createElement(BotChatView, { bot: a, state: null }), c)

    assert.ok(
      [...c.el.querySelectorAll('button')].find(b => b.textContent.includes('重试')),
      'A must retain late failure retry'
    )
  } finally { await act(async () => c.root.unmount()); c.el.remove(); teardownMockFetch() }
})

// ===== 11. Codex 探针：群 A→B→A 旧 POST 不覆盖新一轮 =====
test('Codex: group A-B-A old POST cannot overwrite new generation', async () => {
  setupMockFetch(); const c = createContainer()
  const bots = [makeBot('cx'), makeBot('cy')]
  const a = makeConv('genA', ['cx', 'cy'])
  const input = async (text) => {
    const ta = c.el.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  try {
    await render(React.createElement(GroupChatView, { conversation: a, bots }), c)
    await input('first')
    await act(async () => [...c.el.querySelectorAll('button')].find(b => b.textContent.includes('↑')).click())
    const old = deferredQueue.find(d => d.call.url.includes('/genA/chat'))
    assert.ok(old, 'genA first POST pending')

    // 切 B 再切回 A → 发第二轮
    await rerender(React.createElement(GroupChatView, { conversation: makeConv('genB', ['cx','cy']), bots }), c)
    await rerender(React.createElement(GroupChatView, { conversation: a, bots }), c)
    await input('second')
    await act(async () => [...c.el.querySelectorAll('button')].find(b => b.textContent.includes('↑')).click())

    // 旧 POST 返回
    await act(async () => old.resolve({
      ok: true, status: 200,
      json: async () => ({ messages: [{ ts: 1, role: 'bot', botId: 'cx', text: 'OLD_GENERATION_ONLY' }] })
    }))
    assert.ok(!c.el.textContent.includes('OLD_GENERATION_ONLY'), 'old generation must not replace new state')
  } finally { await act(async () => c.root.unmount()); c.el.remove(); teardownMockFetch() }
})
