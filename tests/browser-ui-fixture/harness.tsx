// 浏览器操作证据 harness：真实 BotChatView/GroupChatView + 确定性 mock fetch + 父级互斥视图切换。
// 页面暴露 [DM A] [群] [卸载视图] 切换按钮（模拟 GrokbotMainView 互斥渲染），#netlog 记录每次
// 请求的方法/路径/body 摘要（taskId 是否携带）——浏览器内可直观验证草稿/任务引用跨卸载保留。
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BotChatView, GroupChatView } from '../../src/client/index'

// mock fetch 必须先于组件模块就绪（组件顶层即可能触发 catalog 等请求）
const netlog: string[] = []
function log(line: string): void {
  netlog.push(line)
  const el = document.getElementById('netlog')
  if (el) el.textContent = `${netlog.slice(-8).join('\n')}\n`
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
;(globalThis as any).fetch = async (url: string, opts: any) => {
  const method = opts?.method ?? 'GET'
  let bodySummary = ''
  if (opts?.body) {
    try {
      const b = JSON.parse(String(opts.body))
      bodySummary = ` text=${String(b.text ?? '').slice(0, 24)} requestId=${String(b.requestId ?? '').slice(0, 12)}${b.taskId ? ` taskId=${b.taskId}` : ' taskId=<无>'}`
    } catch { bodySummary = ' body=?' }
  }
  log(`${method} ${String(url).replace('/api/plugins/grokbot', '')}${bodySummary}`)
  await sleep(30)
  const u = String(url)
  const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) })
  if (u.includes('/conversations/dm-browser-a') && method === 'GET') {
    return json({ messages: [
      { ts: 1, role: 'user', text: '浏览器验证：做一份报告' },
      { ts: 2, role: 'bot', text: '已交付', artifact: { id: 'art-br1', name: 'report.html', size: 9, mime: 'text/html', sha256: 'a'.repeat(64), taskId: 'task-br1' } },
    ] })
  }
  if (u.includes('/conversations/dm-browser-a/chat')) {
    return json({ reply: 'DM 回复（模拟）', activity: [] })
  }
  if (u.includes('/conversations/grp-browser') && method === 'GET') {
    return json({ messages: [
      { ts: 1, role: 'bot', botId: 'cx', text: '群内交付', artifact: { id: 'art-grp', name: 'group-report.html', size: 11, mime: 'text/html', sha256: 'b'.repeat(64), taskId: 'task-grp' } },
    ] })
  }
  if (u.includes('/conversations/grp-browser/chat')) {
    return json({ messages: [{ ts: Date.now(), role: 'bot', botId: 'cx', text: '群回复（模拟）' }] })
  }
  if (u.includes('/model-catalog')) return json({ catalog: [] })
  return json({})
}

const botA = { id: 'dm-browser-a', name: '写手A', avatar: '🤖', title: '', pinned: false, section: '', hidden: false, status: 'idle', currentJob: null, lastActivity: null, rating: null }
const bots = [
  { id: 'cx', name: '成员X', avatar: '🤖', title: '', pinned: false, section: '', hidden: false, status: 'idle', currentJob: null, lastActivity: null, rating: null },
  { id: 'cy', name: '成员Y', avatar: '🤖', title: '', pinned: false, section: '', hidden: false, status: 'idle', currentJob: null, lastActivity: null, rating: null },
]
const group = { id: 'grp-browser', name: '浏览器验证群', memberBotIds: ['cx', 'cy'], isGroup: true }

function HarnessApp(): React.ReactElement {
  const [view, setView] = React.useState<'none' | 'dm' | 'group'>('none')
  const btn = (label: string, next: 'none' | 'dm' | 'group') => (
    <button type="button" data-target={label} onClick={() => setView(next)} style={{ margin: 4, padding: '6px 14px', fontSize: 14, cursor: 'pointer' }}>{label}</button>
  )
  return (
    <div style={{ fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 18 }}>browser-ui-harness（隔离，无真实会话）</h1>
      <div>
        {btn('打开 DM A', 'dm')}{btn('切到群', 'group')}{btn('卸载视图', 'none')}
      </div>
      <div id="view-root" style={{ border: '1px solid #ccc', height: 460, overflow: 'auto' }}>
        {view === 'dm' ? <BotChatView bot={botA} state={null} /> : view === 'group' ? <GroupChatView conversation={group} bots={bots} /> : <div style={{ padding: 20, color: '#888' }}>（视图已卸载——点击上方按钮挂载）</div>}
      </div>
      <h2 style={{ fontSize: 14 }}>#netlog（本页全部请求）</h2>
      <pre id="netlog" style={{ background: '#f6f6f6', padding: 8, fontSize: 12, whiteSpace: 'pre-wrap' }} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<HarnessApp />)
