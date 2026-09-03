import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

const API_ROOT = '/api/plugins/grokbot'
const POLL_MS = 2000

interface BotInfo {
  id: string
  name: string
  avatar: string
  status: 'idle' | 'working'
  currentJob: string | null
  lastActivity: number | null
}

interface GrokbotState {
  bots: BotInfo[]
  running: { jobId: string; botId: string; startedAt: number }[]
  queueDepth: number
  recentJobs: { jobId: string; botId: string; status: string; endedAt: number | null }[]
}

interface ChatMessage {
  id: string
  role: 'user' | 'bot' | 'error'
  text: string
  at: number
}

const GROKBOT_CSS = `
.grokbot-sidebar { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px 10px; }
.grokbot-sidebar__title { display:flex; align-items:center; gap:8px; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; opacity:.55; margin:6px 2px 6px; }
.grokbot-sidebar__title .grokbot-dot { width:6px; height:6px; border-radius:50%; background:#8a8f98; flex:none; }
.grokbot-sidebar__title .grokbot-dot.on { background:#2ea043; box-shadow:0 0 5px #2ea04399; }
.grokbot-sidebar__queue { margin-left:auto; font-size:10px; opacity:.6; text-transform:none; letter-spacing:0; }
.grokbot-sidebar__native { margin-left:auto; border:none; background:none; cursor:pointer; opacity:.45; font-size:12px; padding:1px 5px; border-radius:5px; }
.grokbot-sidebar__native:hover { opacity:1; background:rgba(127,127,127,.15); }
.grokbot-sidebar__queue + .grokbot-sidebar__native { margin-left:0; }
.grokbot-botrow {
  display:flex; align-items:center; gap:10px; width:100%; padding:8px 10px; border:none; border-radius:10px;
  background:transparent; cursor:pointer; text-align:left; font:inherit; color:inherit; transition: background .12s ease;
}
.grokbot-botrow:hover { background:rgba(127,127,127,.14); }
.grokbot-botrow.active { background:rgba(59,130,246,.16); }
.grokbot-botrow__avatar { font-size:20px; line-height:1; flex:none; }
.grokbot-botrow__main { flex:1; min-width:0; }
.grokbot-botrow__name { font-size:13px; font-weight:600; }
.grokbot-botrow__status { font-size:11px; opacity:.6; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-botrow__badge { width:8px; height:8px; border-radius:50%; background:#2ea043; flex:none; }
.grokbot-botrow__badge.working { background:#f0883e; animation: grokbot-pulse 1.2s infinite; }
@keyframes grokbot-pulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }
.grokbot-stage { position:fixed; inset:0; z-index:1200; display:flex; align-items:stretch; justify-content:center; background:rgba(15,17,21,.46); backdrop-filter: blur(2px); }
.grokbot-chat { width:min(880px, 96vw); height:100%; display:flex; flex-direction:column; background:var(--background, #fff); box-shadow:0 0 48px rgba(0,0,0,.25); }
.grokbot-chat__head { display:flex; align-items:center; gap:12px; padding:16px 22px; border-bottom:1px solid var(--border, #e3e5e8); }
.grokbot-chat__avatar { font-size:26px; }
.grokbot-chat__title { flex:1; display:flex; flex-direction:column; }
.grokbot-chat__name { font-weight:700; font-size:16px; }
.grokbot-chat__meta { font-size:12px; opacity:.6; }
.grokbot-chat__close { border:none; background:none; font-size:20px; cursor:pointer; opacity:.55; padding:2px 8px; border-radius:8px; }
.grokbot-chat__close:hover { opacity:1; background:rgba(127,127,127,.14); }
.grokbot-log { flex:1; overflow-y:auto; padding:26px 30px; display:flex; flex-direction:column; gap:14px; }
.grokbot-msg { max-width:78%; border-radius:14px; padding:10px 14px; font-size:14.5px; line-height:1.55; white-space:pre-wrap; word-break:break-word; }
.grokbot-msg.user { align-self:flex-end; background:#3b82f6; color:#fff; border-bottom-right-radius:5px; }
.grokbot-msg.bot { align-self:flex-start; background:var(--background-muted, #f2f3f5); border-bottom-left-radius:5px; }
.grokbot-msg.error { align-self:center; background:#fff1f0; color:#cf1322; font-size:12px; }
.grokbot-msg .grokbot-msg__time { display:block; font-size:10px; opacity:.5; margin-top:5px; }
.grokbot-empty { margin:auto; text-align:center; opacity:.5; font-size:13px; }
.grokbot-inputbar { display:flex; gap:10px; padding:16px 22px 20px; border-top:1px solid var(--border, #e3e5e8); }
.grokbot-inputbar textarea { flex:1; resize:none; border:1px solid var(--border, #d8dbe0); border-radius:12px; padding:11px 14px; font:inherit; min-height:48px; max-height:160px; background:transparent; color:inherit; }
.grokbot-inputbar textarea:focus { outline:2px solid #3b82f655; }
.grokbot-inputbar button { border:none; border-radius:12px; background:#3b82f6; color:#fff; padding:0 20px; font-weight:600; cursor:pointer; }
.grokbot-inputbar button:disabled { opacity:.45; cursor:default; }
`

let openBotId: string | null = null
let nativeSidebarVisible = false
const listeners = new Set<() => void>()

function toggleNativeSidebar(): void {
  nativeSidebarVisible = !nativeSidebarVisible
  for (const listener of listeners) listener()
}

function openBot(botId: string): void {
  openBotId = botId
  for (const listener of listeners) listener()
}

function closeBot(): void {
  openBotId = null
  for (const listener of listeners) listener()
}

const histories = new Map<string, ChatMessage[]>()

function historyOf(botId: string): ChatMessage[] {
  let list = histories.get(botId)
  if (!list) {
    list = []
    histories.set(botId, list)
  }
  return list
}

function appendHistory(botId: string, message: ChatMessage): void {
  historyOf(botId).push(message)
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(String(body?.error || `HTTP ${res.status}`))
  return body
}

function useGrokbotState(): GrokbotState | null {
  const [state, setState] = useState<GrokbotState | null>(null)
  useEffect(() => {
    let alive = true
    const tick = (): void => {
      api('/state').then((next) => { if (alive) setState(next as GrokbotState) }).catch(() => undefined)
    }
    tick()
    const timer = setInterval(tick, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return state
}

function useOpenBotId(): string | null {
  const [, force] = useState(0)
  useEffect(() => {
    const listener = (): void => force((n) => n + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  return openBotId
}

function useNativeSidebarVisible(): boolean {
  const [visible, setVisible] = useState(nativeSidebarVisible)
  useEffect(() => {
    const listener = (): void => setVisible(nativeSidebarVisible)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  return visible
}

function statusLine(bot: BotInfo): string {
  if (bot.status === 'working') {
    const job = bot.currentJob ? ` · ${bot.currentJob}` : ''
    return `工作中${job}`
  }
  return '待命'
}

/**
 * 侧栏 agent 团队列表：挂进 sidebar.workspaces 插槽。
 * 挂载后把同容器的原有节点（默认工作区/会话树）结构化隐藏，
 * 实现整栏替换；卸载时恢复显示。
 */
export function GrokbotSidebarCrew(): ReactNode {
  const state = useGrokbotState()
  const openId = useOpenBotId()
  const nativeVisible = useNativeSidebarVisible()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const hiddenRef = useRef<HTMLElement[]>([])

  useEffect(() => {
    if (nativeVisible) return
    const root = rootRef.current
    const container = root?.parentElement
    if (!container) return
    const apply = (): void => {
      for (const child of [...container.children]) {
        if (child === root || child.contains(root)) continue
        const el = child as HTMLElement
        if (el.dataset.grokbotKept === undefined && el.style.display !== 'none') {
          el.dataset.grokbotPrevDisplay = el.style.display
          el.style.display = 'none'
          hiddenRef.current.push(el)
        }
      }
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(container, { childList: true })
    return () => {
      observer.disconnect()
      for (const el of hiddenRef.current) {
        el.style.display = el.dataset.grokbotPrevDisplay || ''
        delete el.dataset.grokbotPrevDisplay
      }
      hiddenRef.current = []
    }
  }, [nativeVisible])

  const bots = state?.bots ?? []
  const busy = (state?.running.length ?? 0) + (state?.queueDepth ?? 0)

  return (
    <div className="grokbot-sidebar" ref={rootRef}>
      <div className="grokbot-sidebar__title">
        <span className={`grokbot-dot${busy > 0 ? ' on' : ''}`} />
        <span>Agent 团队</span>
        {state && state.queueDepth > 0
          ? <span className="grokbot-sidebar__queue">队列 {state.queueDepth}</span>
          : null}
        <button
          type="button"
          className="grokbot-sidebar__native"
          title={nativeVisible ? '隐藏原始列表' : '显示原始工作区/会话列表'}
          onClick={() => toggleNativeSidebar()}
        >⇅</button>
      </div>
      {bots.map((bot) => (
        <button
          key={bot.id}
          type="button"
          className={`grokbot-botrow${openId === bot.id ? ' active' : ''}`}
          onClick={() => openBot(bot.id)}
        >
          <span className="grokbot-botrow__avatar">{bot.avatar}</span>
          <span className="grokbot-botrow__main">
            <span className="grokbot-botrow__name">{bot.name}</span>
            <span className="grokbot-botrow__status">{statusLine(bot)}</span>
          </span>
          <span className={`grokbot-botrow__badge${bot.status === 'working' ? ' working' : ''}`} />
        </button>
      ))}
    </div>
  )
}

function BotChatView(props: { bot: BotInfo }): ReactNode {
  const { bot } = props
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const logRef = useRef<HTMLDivElement | null>(null)
  const messages = useMemo(() => historyOf(bot.id), [bot.id, sending])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages.length, sending])

  const send = useCallback(async (): Promise<void> => {
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')
    appendHistory(bot.id, { id: `${Date.now()}-u`, role: 'user', text, at: Date.now() })
    setSending(true)
    try {
      const outcome = await api(`/bots/${encodeURIComponent(bot.id)}/chat`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      appendHistory(bot.id, { id: `${Date.now()}-b`, role: 'bot', text: String(outcome?.reply ?? ''), at: Date.now() })
    } catch (error) {
      appendHistory(bot.id, {
        id: `${Date.now()}-e`,
        role: 'error',
        text: String((error as Error)?.message ?? error),
        at: Date.now(),
      })
    } finally {
      setSending(false)
    }
  }, [bot.id, draft, sending])

  return (
    <div className="grokbot-chat" onKeyDown={(event) => { if (event.key === 'Escape') closeBot() }}>
      <div className="grokbot-chat__head">
        <span className="grokbot-chat__avatar">{bot.avatar}</span>
        <span className="grokbot-chat__title">
          <span className="grokbot-chat__name">{bot.name}</span>
          <span className="grokbot-chat__meta">
            {bot.status === 'working' ? '正在执行任务…' : '常驻待命 · 有自己的工作区'}
          </span>
        </span>
        <button className="grokbot-chat__close" type="button" onClick={closeBot} aria-label="关闭">✕</button>
      </div>
      <div className="grokbot-log" ref={logRef}>
        {messages.length === 0
          ? <div className="grokbot-empty">和 {bot.name} 对话，或投递任务给它。<br />它会真实使用工具并在自己的工作区里干活。</div>
          : messages.map((message) => (
            <div key={message.id} className={`grokbot-msg ${message.role}`}>
              {message.text}
              <span className="grokbot-msg__time">{new Date(message.at).toLocaleTimeString()}</span>
            </div>
          ))}
        {sending ? <div className="grokbot-empty">思考中…</div> : null}
      </div>
      <div className="grokbot-inputbar">
        <textarea
          value={draft}
          placeholder={`发消息给 ${bot.name}…`}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <button type="button" disabled={sending || draft.trim().length === 0} onClick={() => void send()}>发送</button>
      </div>
    </div>
  )
}

export function GrokbotStage(): ReactNode {
  const openId = useOpenBotId()
  const state = useGrokbotState()
  const bot = state?.bots.find((entry) => entry.id === openId) ?? null
  if (!bot) return null
  return (
    <div className="grokbot-stage" onClick={(event) => { if (event.target === event.currentTarget) closeBot() }}>
      <BotChatView bot={bot} />
    </div>
  )
}

export const inject = ['slots']

export function apply(ctx: any): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshGrokbot = ''
    style.textContent = GROKBOT_CSS
    document.head.append(style)
    return () => style.remove()
  }, 'grokbot: styles')

  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces',
    id: 'grokbot-crew',
    order: -100,
  }, GrokbotSidebarCrew))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'grokbot-stage',
    order: 51,
  }, GrokbotStage))
}
