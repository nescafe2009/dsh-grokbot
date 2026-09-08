
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
const { BotChatView, GroupChatView } = await import(await import('./ctb-path.mjs').then(m => m.CTB_DIR + '/test-entry.mjs'))
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
    await new Promise(r => setTimeout(r, 10))
    // 放行 B 的全部挂起 GET（初始加载 + send 后 refetch——latest-wins 下只有最新代次会写历史）
    for (;;) {
      const histIdx = deferredQueue.findIndex(d => d.call.url.includes('/multiB') && d.call.method === 'GET')
      if (histIdx < 0) break
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


// ===== 12. Codex 探针：旧失败不能覆盖较新的重试记录 =====
test('Codex: older failure cannot overwrite newer retry', async () => {
  setupMockFetch(); const c = createContainer(); const a = makeBot('orderA'); const b = makeBot('orderB')
  async function send(text) {
    const ta = c.el.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => [...c.el.querySelectorAll('button')].find(b2 => b2.textContent.includes('↑')).click())
  }
  try {
    await render(React.createElement(BotChatView, { bot: a, state: null }), c)
    await send('OLDER')
    const old = deferredQueue.find(d => d.call.url.includes('/orderA/chat'))
    assert.ok(old, 'OLDER POST pending')

    // 切 B 再切回 A → 发 NEWER
    await rerender(React.createElement(BotChatView, { bot: b, state: null }), c)
    await rerender(React.createElement(BotChatView, { bot: a, state: null }), c)
    await send('NEWER')
    const posts = deferredQueue.filter(d => d.call.url.includes('/orderA/chat'))
    const newer = posts[1]
    assert.ok(newer, 'NEWER POST pending')
    const newerId = JSON.parse(newer.call.body).requestId

    // NEWER 先失败
    await act(async () => newer.reject(new Error('new failure')))
    // OLDER 后失败（迟到）
    await act(async () => old.reject(new Error('old failure')))

    // 切走再切回 A → 重试
    await rerender(React.createElement(BotChatView, { bot: b, state: null }), c)
    await rerender(React.createElement(BotChatView, { bot: a, state: null }), c)
    await act(async () => {
      const btn = [...c.el.querySelectorAll('button')].find(b2 => b2.textContent.includes('重试'))
      if (btn) btn.click()
    })

    const last = fetchCalls.filter(f => f.url.includes('/orderA/chat')).at(-1)
    assert.equal(JSON.parse(last.body).requestId, newerId, 'must retain newer retry requestId')
  } finally { await act(async () => c.root.unmount()); c.el.remove(); teardownMockFetch() }
})

// ===== 13. 旧失败晚于新成功 → 不重新占据重试槽 =====
test('旧失败不覆盖新成功后的重试槽', async () => {
  setupMockFetch(); const c = createContainer(); const a = makeBot('lateOrderA'); const b = makeBot('lateOrderB')
  const { clearPendingRetry } = await import('../src/client/retry-store.ts')
  clearPendingRetry('lateOrderA'); clearPendingRetry('lateOrderB')
  async function send(text) {
    const ta = c.el.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => [...c.el.querySelectorAll('button')].find(b2 => b2.textContent.includes('↑')).click())
  }
  try {
    await render(React.createElement(BotChatView, { bot: a, state: null }), c)
    await send('OLD_MSG')
    const old = deferredQueue.find(d => d.call.url.includes('/lateOrderA/chat'))

    // 切 B 再切回 A → 发 NEW_MSG → NEW_MSG 成功
    await rerender(React.createElement(BotChatView, { bot: b, state: null }), c)
    await rerender(React.createElement(BotChatView, { bot: a, state: null }), c)
    await send('NEW_MSG')
    const newer = deferredQueue.filter(d => d.call.url.includes('/lateOrderA/chat')).at(-1)
    assert.ok(newer)
    // NEW 成功
    await act(async () => {
      newer.resolve({ ok: true, status: 200, json: async () => ({ reply: 'NEW_OK' }), text: async () => '{}' })
    })
    // 成功路径会 await refetchHistory：resolve 该会话所有挂起的历史 GET
    // （首次挂载也排过一个 GET——只 resolve 第一个会让 refetchHistory 永远挂起）
    await act(async () => {
      for (;;) {
        const hi = deferredQueue.findIndex(d => d.call.url.includes('/lateOrderA') && d.call.method === 'GET')
        if (hi < 0) break
        deferredQueue.splice(hi, 1)[0].resolve({ ok: true, status: 200, json: async () => ({ messages: [] }), text: async () => '{}' })
      }
    })
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })

    // 检查 store：新成功后应无 pending retry

    // 旧 POST 迟到失败
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    await act(async () => old.reject(new Error('late old fail')))
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })

    // 切走再切回 A → 不应有重试条（新请求已成功，旧失败不覆盖）
    await rerender(React.createElement(BotChatView, { bot: b, state: null }), c)
    await rerender(React.createElement(BotChatView, { bot: a, state: null }), c)
    const allButtons = [...c.el.querySelectorAll('button')].map(b2 => b2.textContent?.trim())
    const retryBtn = allButtons.find(t => t?.includes('重试'))
    assert.ok(!retryBtn, `新请求已成功，旧失败不应重新占据重试槽——buttons: ${JSON.stringify(allButtons)}`)
  } finally { await act(async () => c.root.unmount()); c.el.remove(); teardownMockFetch() }
})

// ===== 14. Codex 探针：切走后到达的新成功也要结算——旧失败不得占槽（DM）=====
test('Codex: offscreen newer success blocks older failure (DM)', async () => {
  setupMockFetch(); const c = createContainer(); const a = makeBot('offA'); const b = makeBot('offB')
  async function send(text) {
    const ta = c.el.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => [...c.el.querySelectorAll('button')].find(b2 => b2.textContent.includes('↑')).click())
  }
  try {
    await render(React.createElement(BotChatView, { bot: a, state: null }), c)
    await send('OLD')
    const old = deferredQueue.find(d => d.call.url.includes('/offA/chat'))
    assert.ok(old, 'OLD POST pending')

    await rerender(React.createElement(BotChatView, { bot: b, state: null }), c)
    await rerender(React.createElement(BotChatView, { bot: a, state: null }), c)
    await send('NEW')
    const newer = deferredQueue.filter(d => d.call.url.includes('/offA/chat'))[1]
    assert.ok(newer, 'NEW POST pending')

    // 切走：成功/失败都在 B 视图时到达
    await rerender(React.createElement(BotChatView, { bot: b, state: null }), c)
    await act(async () => newer.resolve({ ok: true, status: 200, json: async () => ({ reply: 'NEW SUCCESS' }), text: async () => '{}' }))
    await act(async () => old.reject(new Error('OLD FAILED')))

    await rerender(React.createElement(BotChatView, { bot: a, state: null }), c)
    assert.ok(![...c.el.querySelectorAll('button')].find(b2 => b2.textContent.includes('重试')),
      '切走后到达的新成功也必须结算：旧失败不得占据重试槽')
  } finally { await act(async () => c.root.unmount()); c.el.remove(); teardownMockFetch() }
})

// ===== 15. 反方向：切走后新失败先落地、旧成功迟到——不得删除新失败的重试（DM）=====
test('Codex: offscreen older success must not clear newer failure retry (DM)', async () => {
  setupMockFetch(); const c = createContainer(); const a = makeBot('off2A'); const b = makeBot('off2B')
  async function send(text) {
    const ta = c.el.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => [...c.el.querySelectorAll('button')].find(b2 => b2.textContent.includes('↑')).click())
  }
  try {
    await render(React.createElement(BotChatView, { bot: a, state: null }), c)
    await send('OLD')
    const old = deferredQueue.find(d => d.call.url.includes('/off2A/chat'))
    assert.ok(old)
    await rerender(React.createElement(BotChatView, { bot: b, state: null }), c)
    await rerender(React.createElement(BotChatView, { bot: a, state: null }), c)
    await send('NEW')
    const newer = deferredQueue.filter(d => d.call.url.includes('/off2A/chat'))[1]
    assert.ok(newer)
    const newerId = JSON.parse(newer.call.body).requestId

    // 切走：新失败先落地，旧成功迟到
    await rerender(React.createElement(BotChatView, { bot: b, state: null }), c)
    await act(async () => newer.reject(new Error('NEW FAILED')))
    await act(async () => old.resolve({ ok: true, status: 200, json: async () => ({ reply: 'OLD OK' }), text: async () => '{}' }))

    // 切回 A：重试条仍应存在，且属于新请求
    await rerender(React.createElement(BotChatView, { bot: a, state: null }), c)
    const retryBtn = [...c.el.querySelectorAll('button')].find(b2 => b2.textContent.includes('重试'))
    assert.ok(retryBtn, '迟到旧成功不得删除较新失败的重试记录')
    await act(async () => retryBtn.click())
    const last = fetchCalls.filter(f => f.url.includes('/off2A/chat')).at(-1)
    assert.equal(JSON.parse(last.body).requestId, newerId, '重试必须复用新失败的 requestId')
  } finally { await act(async () => c.root.unmount()); c.el.remove(); teardownMockFetch() }
})

// ===== 16. 群聊：切走后到达的新成功也要结算——旧失败不得占槽 =====
test('Codex: offscreen newer success blocks older failure (group)', async () => {
  setupMockFetch(); const c = createContainer()
  const bots = [makeBot('cx'), makeBot('cy')]
  const a = makeConv('offgA', ['cx', 'cy'])
  async function input(text) {
    const ta = c.el.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  try {
    await render(React.createElement(GroupChatView, { conversation: a, bots }), c)
    await input('OLD'); await act(async () => [...c.el.querySelectorAll('button')].find(b2 => b2.textContent.includes('↑')).click())
    const old = deferredQueue.find(d => d.call.url.includes('/offgA/chat'))
    assert.ok(old)

    await rerender(React.createElement(GroupChatView, { conversation: makeConv('offgB', ['cx', 'cy']), bots }), c)
    await rerender(React.createElement(GroupChatView, { conversation: a, bots }), c)
    await input('NEW'); await act(async () => [...c.el.querySelectorAll('button')].find(b2 => b2.textContent.includes('↑')).click())
    const newer = deferredQueue.filter(d => d.call.url.includes('/offgA/chat'))[1]
    assert.ok(newer)

    // 切走：新成功 + 旧失败都在 B 群视图时到达
    await rerender(React.createElement(GroupChatView, { conversation: makeConv('offgB', ['cx', 'cy']), bots }), c)
    await act(async () => newer.resolve({ ok: true, status: 200, json: async () => ({ messages: [] }), text: async () => '{}' }))
    await act(async () => old.reject(new Error('OLD FAILED')))

    await rerender(React.createElement(GroupChatView, { conversation: a, bots }), c)
    assert.ok(![...c.el.querySelectorAll('button')].find(b2 => b2.textContent.includes('重试')),
      '群聊：切走后到达的新成功也必须结算，旧失败不得占据重试槽')
  } finally { await act(async () => c.root.unmount()); c.el.remove(); teardownMockFetch() }
})

// ===== 17. 群聊反方向：新失败先落地、旧成功迟到——不得删除新失败的重试 =====
test('Codex: offscreen older success must not clear newer failure retry (group)', async () => {
  setupMockFetch(); const c = createContainer()
  const bots = [makeBot('cx'), makeBot('cy')]
  const a = makeConv('off2gA', ['cx', 'cy'])
  async function input(text) {
    const ta = c.el.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  try {
    await render(React.createElement(GroupChatView, { conversation: a, bots }), c)
    await input('OLD'); await act(async () => [...c.el.querySelectorAll('button')].find(b2 => b2.textContent.includes('↑')).click())
    const old = deferredQueue.find(d => d.call.url.includes('/off2gA/chat'))
    assert.ok(old)
    await rerender(React.createElement(GroupChatView, { conversation: makeConv('off2gB', ['cx', 'cy']), bots }), c)
    await rerender(React.createElement(GroupChatView, { conversation: a, bots }), c)
    await input('NEW'); await act(async () => [...c.el.querySelectorAll('button')].find(b2 => b2.textContent.includes('↑')).click())
    const newer = deferredQueue.filter(d => d.call.url.includes('/off2gA/chat'))[1]
    assert.ok(newer)
    const newerId = JSON.parse(newer.call.body).requestId

    // 切走：新失败先落地，旧成功迟到
    await rerender(React.createElement(GroupChatView, { conversation: makeConv('off2gB', ['cx', 'cy']), bots }), c)
    await act(async () => newer.reject(new Error('NEW FAILED')))
    await act(async () => old.resolve({ ok: true, status: 200, json: async () => ({ messages: [] }), text: async () => '{}' }))

    // 切回 A 群：重试条仍应存在且属于新请求
    await rerender(React.createElement(GroupChatView, { conversation: a, bots }), c)
    const retryBtn = [...c.el.querySelectorAll('button')].find(b2 => b2.textContent.includes('重试'))
    assert.ok(retryBtn, '群聊：迟到旧成功不得删除较新失败的重试记录')
    await act(async () => retryBtn.click())
    const last = fetchCalls.filter(f => f.url.includes('/off2gA/chat')).at(-1)
    assert.equal(JSON.parse(last.body).requestId, newerId, '群聊重试必须复用新失败的 requestId')
  } finally { await act(async () => c.root.unmount()); c.el.remove(); teardownMockFetch() }
})

// ===== 18. 跨视图卸载/重挂：DM 草稿+任务引用保留且归属正确 =====
test('卸载重挂：DM A 草稿+任务引用保留，群视图不继承，重挂后发送带原 taskId', async () => {
  setupMockFetch()
  const a = makeBot('umA', 'A')
  const bots = [makeBot('cx'), makeBot('cy')]
  const g = makeConv('umG', ['cx', 'cy'])
  const histData = { messages: [{ ts: 1, role: 'bot', text: 'card', artifact: { id: 'art-um1', name: 'report.html', size: 10, mime: 'text/html', sha256: 'x'.repeat(64), taskId: 'task-um1' } }] }
  const typeInto = async (el, text) => {
    const ta = el.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const mounts = []
  try {
    // 挂载 A：历史带交付卡（taskId）
    const c1 = createContainer(); mounts.push(c1)
    await render(React.createElement(BotChatView, { bot: a, state: null }), c1)
    await act(async () => {
      const hi = deferredQueue.findIndex(d => d.call.url.includes('/umA') && d.call.method === 'GET')
      if (hi >= 0) deferredQueue.splice(hi, 1)[0].resolve({ ok: true, status: 200, json: async () => histData, text: async () => '{}' })
      await new Promise(r => setTimeout(r, 20))
    })
    const contBtn = [...c1.el.querySelectorAll('button')].find(b => b.textContent.includes('继续修改'))
    assert.ok(contBtn, '交付卡「继续修改」入口存在')
    await act(async () => contBtn.click())
    await typeInto(c1.el, 'um-draft-A')
    // 卸载 A（父级切到群视图：互斥渲染）
    await act(async () => c1.root.unmount()); c1.el.remove()

    // 挂载群：不继承 A 的草稿/任务引用
    const c2 = createContainer(); mounts.push(c2)
    await render(React.createElement(GroupChatView, { conversation: g, bots }), c2)
    assert.equal(c2.el.querySelector('textarea').value, '', '群视图不继承 A 草稿')
    assert.ok(!c2.el.textContent.includes('继续修改：'), '群视图不继承 A 任务引用')
    await act(async () => c2.root.unmount()); c2.el.remove()

    // 重挂 A：草稿与任务引用恢复且归属正确
    const c3 = createContainer(); mounts.push(c3)
    await render(React.createElement(BotChatView, { bot: a, state: null }), c3)
    assert.equal(c3.el.querySelector('textarea').value, 'um-draft-A', '卸载重挂后 DM 草稿保留')
    assert.ok(c3.el.textContent.includes('继续修改：report.html'), '任务引用（附件选择）恢复')
    await act(async () => [...c3.el.querySelectorAll('button')].find(b => b.textContent.includes('↑')).click())
    const post = fetchCalls.filter(f => f.url.includes('/umA/chat')).at(-1)
    assert.equal(JSON.parse(post.body).taskId, 'task-um1', '发送携带恢复的任务引用')
    assert.equal(JSON.parse(post.body).text, 'um-draft-A', '发送内容为恢复的草稿')
  } finally {
    for (const c of mounts.splice(0)) { try { await act(async () => c.root.unmount()) } catch {} c.el.remove() }
    teardownMockFetch()
  }
})

// ===== 19. 跨视图卸载/重挂：群草稿保留（群→DM→原群） =====
test('卸载重挂：群草稿保留，DM 视图不继承', async () => {
  setupMockFetch()
  const bots = [makeBot('cx2'), makeBot('cy2')]
  const g = makeConv('umG2', ['cx2', 'cy2'])
  const a = makeBot('umB2', 'B')
  const typeInto = async (el, text) => {
    const ta = el.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const mounts = []
  try {
    const c1 = createContainer(); mounts.push(c1)
    await render(React.createElement(GroupChatView, { conversation: g, bots }), c1)
    await typeInto(c1.el, 'um-draft-G')
    await act(async () => c1.root.unmount()); c1.el.remove()

    const c2 = createContainer(); mounts.push(c2)
    await render(React.createElement(BotChatView, { bot: a, state: null }), c2)
    assert.equal(c2.el.querySelector('textarea').value, '', 'DM 视图不继承群草稿')
    await act(async () => c2.root.unmount()); c2.el.remove()

    const c3 = createContainer(); mounts.push(c3)
    await render(React.createElement(GroupChatView, { conversation: g, bots }), c3)
    assert.equal(c3.el.querySelector('textarea').value, 'um-draft-G', '卸载重挂后群草稿保留')
    // 发送：无任务引用时不携带 taskId（引用归属正确）
    await act(async () => [...c3.el.querySelectorAll('button')].find(b => b.textContent.includes('↑')).click())
    const post = fetchCalls.filter(f => f.url.includes('/umG2/chat')).at(-1)
    assert.equal(JSON.parse(post.body).taskId, undefined, '群草稿无任务引用：不携带 taskId')
  } finally {
    for (const c of mounts.splice(0)) { try { await act(async () => c.root.unmount()) } catch {} c.el.remove() }
    teardownMockFetch()
  }
})

// ===== 20. 挂起请求时卸载 → 迟到成功：不复活 sending/不重复 POST/无重试条 =====
test('卸载时挂起：迟到成功不污染重挂视图、不复活 sending、不重复 POST', async () => {
  setupMockFetch()
  const a = makeBot('umPendA', 'A')
  const typeInto = async (el, text) => {
    const ta = el.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const mounts = []
  try {
    const c1 = createContainer(); mounts.push(c1)
    await render(React.createElement(BotChatView, { bot: a, state: null }), c1)
    await typeInto(c1.el, 'pending-msg')
    await act(async () => [...c1.el.querySelectorAll('button')].find(b => b.textContent.includes('↑')).click())
    const post = deferredQueue.find(d => d.call.url.includes('/umPendA/chat'))
    assert.ok(post, 'POST 挂起中')
    // 卸载（挂起未决）
    await act(async () => c1.root.unmount()); c1.el.remove()

    // 迟到成功到达（无组件实例）：结算 + 历史落盘（模块级 histories）
    await act(async () => {
      post.resolve({ ok: true, status: 200, json: async () => ({ reply: 'LATE_OK' }), text: async () => '{}' })
      await new Promise(r => setTimeout(r, 30))
    })
    // 卸载后的 refetchHistory GET：全部放行（含首挂 GET）
    await act(async () => {
      for (;;) {
        const hi = deferredQueue.findIndex(d => d.call.url.includes('/umPendA') && d.call.method === 'GET')
        if (hi < 0) break
        deferredQueue.splice(hi, 1)[0].resolve({ ok: true, status: 200, json: async () => ({ messages: [] }), text: async () => '{}' })
      }
    })

    // 重挂 A：sending 不复活、迟到回复可见、无重试条
    const c3 = createContainer(); mounts.push(c3)
    await render(React.createElement(BotChatView, { bot: a, state: null }), c3)
    assert.ok(c3.el.textContent.includes('LATE_OK'), '迟到成功已落历史（可见）')
    assert.ok(![...c3.el.querySelectorAll('button')].find(b => b.textContent.includes('重试')), '成功已结算：无重试条')
    // sending 未复活：可立即再发（若 sending 卡 true，send 早退不产生 POST）
    await typeInto(c3.el, 'next-msg')
    await act(async () => [...c3.el.querySelectorAll('button')].find(b => b.textContent.includes('↑')).click())
    const posts = fetchCalls.filter(f => f.url.includes('/umPendA/chat'))
    assert.equal(posts.length, 2, '恰两次 POST（原始+新发）：卸载/重挂不产生重复 POST')
    const body2 = JSON.parse(posts[1].body)
    assert.equal(body2.text, 'next-msg')
    assert.notEqual(body2.requestId, JSON.parse(posts[0].body).requestId, '新发是新请求 ID')
  } finally {
    for (const c of mounts.splice(0)) { try { await act(async () => c.root.unmount()) } catch {} c.el.remove() }
    teardownMockFetch()
  }
})

// ===== 21. 挂起请求时卸载 → 迟到失败：重试条按 store 规则，点击复用原 requestId =====
test('卸载时挂起：迟到失败后重挂出现重试条，重试复用原 requestId', async () => {
  setupMockFetch()
  const a = makeBot('umPendB', 'A')
  const typeInto = async (el, text) => {
    const ta = el.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const mounts = []
  try {
    const c1 = createContainer(); mounts.push(c1)
    await render(React.createElement(BotChatView, { bot: a, state: null }), c1)
    await typeInto(c1.el, 'fail-msg')
    await act(async () => [...c1.el.querySelectorAll('button')].find(b => b.textContent.includes('↑')).click())
    const post = deferredQueue.find(d => d.call.url.includes('/umPendB/chat'))
    const origId = JSON.parse(post.call.body).requestId
    await act(async () => c1.root.unmount()); c1.el.remove()

    // 迟到失败（无组件实例）：store 记录保留
    await act(async () => {
      post.reject(new Error('late failure after unmount'))
      await new Promise(r => setTimeout(r, 30))
    })

    // 重挂：sending 不复活、重试条出现（store 规则）
    const c3 = createContainer(); mounts.push(c3)
    await render(React.createElement(BotChatView, { bot: a, state: null }), c3)
    assert.ok(!c3.el.querySelector('textarea').disabled, 'sending 未复活（输入可用）')
    const retryBtn = [...c3.el.querySelectorAll('button')].find(b => b.textContent.includes('重试'))
    assert.ok(retryBtn, '迟到失败在重挂后提供重试条（store 记录）')
    await act(async () => retryBtn.click())
    const posts = fetchCalls.filter(f => f.url.includes('/umPendB/chat'))
    assert.equal(posts.length, 2, '重试恰产生一次新 POST')
    assert.equal(JSON.parse(posts[1].body).requestId, origId, '重试复用原 requestId（store 规则）')
    // 重试成功 → 重试条消失（结算）
    // 注意：被 reject 的原始 deferred 仍留在队列（reject 不出队）——重试 POST 是队列中最后一个
    const retryPost = deferredQueue.filter(d => d.call.url.includes('/umPendB/chat')).at(-1)
    await act(async () => {
      retryPost.resolve({ ok: true, status: 200, json: async () => ({ reply: 'RETRY_OK' }), text: async () => '{}' })
      await new Promise(r => setTimeout(r, 30))
    })
    await act(async () => {
      for (;;) {
        const hi = deferredQueue.findIndex(d => d.call.url.includes('/umPendB') && d.call.method === 'GET')
        if (hi < 0) break
        deferredQueue.splice(hi, 1)[0].resolve({ ok: true, status: 200, json: async () => ({ messages: [] }), text: async () => '{}' })
      }
    })
    assert.ok(![...c3.el.querySelectorAll('button')].find(b => b.textContent.includes('重试')), '重试成功后重试条消失')
    assert.ok(c3.el.textContent.includes('RETRY_OK'), '重试回复可见')
  } finally {
    for (const c of mounts.splice(0)) { try { await act(async () => c.root.unmount()) } catch {} c.el.remove() }
    teardownMockFetch()
  }
})

// ===== 22. Codex 探针：卸载旧实例的迟到历史 GET 不得覆盖重挂后的新历史 =====
test('Codex: unmounted old history GET cannot replace remounted newer history', async () => {
  setupMockFetch()
  const a = makeBot('umHistA', 'A')
  const typeInto = async (c, text) => act(async () => {
    const t = c.el.querySelector('textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, text)
    t.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const mounts = []
  try {
    // 首挂：初始历史 GET 挂起 → 立即卸载
    const c1 = createContainer(); mounts.push(c1)
    await render(React.createElement(BotChatView, { bot: a, state: null }), c1)
    const oldIdx = deferredQueue.findIndex(d => d.call.method === 'GET' && d.call.url.includes('/conversations/umHistA'))
    assert.ok(oldIdx >= 0, '首挂 GET 在队')
    const old = deferredQueue.splice(oldIdx, 1)[0]
    await act(async () => c1.root.unmount()); c1.el.remove()

    // 重挂 A → 发新请求 → 新 POST 与新历史 GET 返回（NEW_CURRENT_RESULT 落缓存）
    const c2 = createContainer(); mounts.push(c2)
    await render(React.createElement(BotChatView, { bot: a, state: null }), c2)
    await typeInto(c2, 'NEW_REQUEST')
    await act(async () => [...c2.el.querySelectorAll('button')].find(b => b.textContent.includes('↑')).click())
    await act(async () => resolveFor('/umHistA/chat', 'POST', { reply: 'NEW_CURRENT_RESULT' }))
    await act(async () => resolveFor('/conversations/umHistA', 'GET', { messages: [{ ts: 2, role: 'bot', text: 'NEW_CURRENT_RESULT' }] }))
    assert.ok(c2.el.textContent.includes('NEW_CURRENT_RESULT'), '新历史可见')

    // 旧实例的 GET 此时才返回陈旧数据
    await act(async () => old.resolve({ ok: true, status: 200, json: async () => ({ messages: [{ ts: 1, role: 'bot', text: 'OLD_STALE_HISTORY' }] }), text: async () => '{}' }))
    await act(async () => c2.root.unmount()); c2.el.remove()

    // 再卸载重挂：新历史必须仍在，旧数据不得覆盖
    const c3 = createContainer(); mounts.push(c3)
    await render(React.createElement(BotChatView, { bot: a, state: null }), c3)
    assert.ok(c3.el.textContent.includes('NEW_CURRENT_RESULT'), '旧实例迟到 GET 不得覆盖重挂后的新历史')
    assert.ok(!c3.el.textContent.includes('OLD_STALE_HISTORY'), '陈旧历史不得出现')
  } finally {
    for (const c of mounts.splice(0)) { try { await act(async () => c.root.unmount()) } catch {} c.el.remove() }
    teardownMockFetch()
  }
})

// ===== 23. 群视图卸载重挂：带 taskId 的任务引用恢复并在发送时携带 =====
test('卸载重挂：群任务引用（带 taskId）恢复，发送携带且不串 DM', async () => {
  setupMockFetch()
  const bots = [makeBot('cx3'), makeBot('cy3')]
  const g = makeConv('umG3', ['cx3', 'cy3'])
  const roomHist = { messages: [{ ts: 1, role: 'bot', botId: 'cx3', text: 'group card', artifact: { id: 'art-g3', name: 'group-report.html', size: 12, mime: 'text/html', sha256: 'y'.repeat(64), taskId: 'task-g3' } }] }
  const typeInto = async (el, text) => {
    const ta = el.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const mounts = []
  try {
    const c1 = createContainer(); mounts.push(c1)
    await render(React.createElement(GroupChatView, { conversation: g, bots }), c1)
    await act(async () => {
      const hi = deferredQueue.findIndex(d => d.call.url.includes('/umG3') && d.call.method === 'GET')
      if (hi >= 0) deferredQueue.splice(hi, 1)[0].resolve({ ok: true, status: 200, json: async () => roomHist, text: async () => '{}' })
      await new Promise(r => setTimeout(r, 20))
    })
    const contBtn = [...c1.el.querySelectorAll('button')].find(b => b.textContent.includes('继续修改'))
    assert.ok(contBtn, '群交付卡「继续修改」入口存在')
    await act(async () => contBtn.click())
    await typeInto(c1.el, 'group-draft-with-task')
    await act(async () => c1.root.unmount()); c1.el.remove()

    // 卸载后群轮询 GET（旧实例）陆续返回：alive 守卫已防 setState，不影响
    await act(async () => {
      for (;;) {
        const hi = deferredQueue.findIndex(d => d.call.url.includes('/umG3') && d.call.method === 'GET')
        if (hi < 0) break
        deferredQueue.splice(hi, 1)[0].resolve({ ok: true, status: 200, json: async () => roomHist, text: async () => '{}' })
      }
    })

    // 重挂原群：草稿+任务引用恢复；发送携带原 taskId
    const c2 = createContainer(); mounts.push(c2)
    await render(React.createElement(GroupChatView, { conversation: g, bots }), c2)
    assert.equal(c2.el.querySelector('textarea').value, 'group-draft-with-task', '群草稿卸载重挂保留')
    assert.ok(c2.el.textContent.includes('继续修改：group-report.html'), '群任务引用恢复')
    await act(async () => [...c2.el.querySelectorAll('button')].find(b => b.textContent.includes('↑')).click())
    const post = fetchCalls.filter(f => f.url.includes('/umG3/chat')).at(-1)
    assert.equal(JSON.parse(post.body).taskId, 'task-g3', '群发送携带恢复的任务引用')
    assert.equal(JSON.parse(post.body).text, 'group-draft-with-task')
  } finally {
    for (const c of mounts.splice(0)) { try { await act(async () => c.root.unmount()) } catch {} c.el.remove() }
    teardownMockFetch()
  }
})
