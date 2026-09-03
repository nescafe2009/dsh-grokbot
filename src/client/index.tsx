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
.grokbot-dock { margin: 10px 0 4px; }
.grokbot-dock__title { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; opacity:.75; margin: 0 2px 8px; }
.grokbot-dock__title .grokbot-dot { width:7px; height:7px; border-radius:50%; background:#8a8f98; }
.grokbot-dock__title .grokbot-dot.on { background:#2ea043; box-shadow:0 0 6px #2ea04388; }
.grokbot-crew { display:flex; flex-wrap:wrap; gap:10px; }
.grokbot-card {
  display:flex; align-items:center; gap:10px; padding:10px 14px; border:1px solid var(--border, #d8dbe0);
  border-radius:12px; background:var(--background, #fff); cursor:pointer; min-width:210px; text-align:left;
  transition: box-shadow .15s ease, transform .15s ease; font: inherit; color: inherit;
}
.grokbot-card:hover { box-shadow:0 2px 12px rgba(0,0,0,.10); transform: translateY(-1px); }
.grokbot-card__avatar { font-size:22px; line-height:1; }
.grokbot-card__main { flex:1; min-width:0; }
.grokbot-card__name { font-weight:600; font-size:14px; }
.grokbot-card__status { font-size:12px; opacity:.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-card__badge { width:8px; height:8px; border-radius:50%; background:#2ea043; flex:none; }
.grokbot-card__badge.working { background:#f0883e; animation: grokbot-pulse 1.2s infinite; }
@keyframes grokbot-pulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }
.grokbot-overlay { position:fixed; inset:0; z-index:1200; display:flex; align-items:stretch; justify-content:flex-end; background:rgba(0,0,0,.32); }
.grokbot-panel { width:min(440px, 92vw); height:100%; display:flex; flex-direction:column; background:var(--background, #fff); box-shadow:-8px 0 32px rgba(0,0,0,.18); }
.grokbot-panel__head { display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid var(--border, #e3e5e8); }
.grokbot-panel__title { flex:1; font-weight:700; }
.grokbot-panel__meta { font-size:12px; opacity:.65; }
.grokbot-panel__close { border:none; background:none; font-size:20px; cursor:pointer; opacity:.6; padding:2px 6px; }
.grokbot-panel__close:hover { opacity:1; }
.grokbot-log { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:12px; }
.grokbot-msg { max-width:86%; border-radius:12px; padding:9px 12px; font-size:14px; white-space:pre-wrap; word-break:break-word; }
.grokbot-msg.user { align-self:flex-end; background:#3b82f6; color:#fff; border-bottom-right-radius:4px; }
.grokbot-msg.bot { align-self:flex-start; background:var(--background-muted, #f2f3f5); border-bottom-left-radius:4px; }
.grokbot-msg.error { align-self:center; background:#fff1f0; color:#cf1322; font-size:12px; }
.grokbot-msg .grokbot-msg__time { display:block; font-size:10px; opacity:.55; margin-top:4px; }
.grokbot-empty { margin:auto; text-align:center; opacity:.55; font-size:13px; }
.grokbot-inputbar { display:flex; gap:8px; padding:12px; border-top:1px solid var(--border, #e3e5e8); }
.grokbot-inputbar textarea { flex:1; resize:none; border:1px solid var(--border, #d8dbe0); border-radius:10px; padding:9px 11px; font: inherit; min-height:44px; max-height:140px; background:transparent; color:inherit; }
.grokbot-inputbar button { border:none; border-radius:10px; background:#3b82f6; color:#fff; padding:0 16px; font-weight:600; cursor:pointer; }
.grokbot-inputbar button:disabled { opacity:.5; cursor:default; }
`

let openBotId: string | null = null
const listeners = new Set<() => void>()

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

function useOverlayOpen(): string | null {
  const [, force] = useState(0)
  useEffect(() => {
    const listener = (): void => force((n) => n + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  return openBotId
}

export function GrokbotHomeCrew(): ReactNode {
  const state = useGrokbotState()
  const bots = state?.bots ?? []
  if (bots.length === 0) return null
  return (
    <div className="grokbot-dock">
      <div className="grokbot-dock__title">
        <span className={`grokbot-dot${state && state.queueDepth + state.running.length > 0 ? ' on' : ''}`} />
        <span>Agent 团队 · 常驻接活</span>
        {state && state.queueDepth > 0 ? <span>（队列 {state.queueDepth}）</span> : null}
      </div>
      <div className="grokbot-crew">
        {bots.map((bot) => (
          <button key={bot.id} className="grokbot-card" type="button" onClick={() => openBot(bot.id)}>
            <span className="grokbot-card__avatar">{bot.avatar}</span>
            <span className="grokbot-card__main">
              <span className="grokbot-card__name">{bot.name}</span>
              <span className="grokbot-card__status">
                {bot.status === 'working' ? `工作中 · ${bot.currentJob ?? ''}` : '待命 · 点击对话'}
              </span>
            </span>
            <span className={`grokbot-card__badge${bot.status === 'working' ? ' working' : ''}`} />
          </button>
        ))}
      </div>
    </div>
  )
}

function BotChatPanel(props: { bot: BotInfo }): ReactNode {
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
    <div className="grokbot-panel" onKeyDown={(event) => { if (event.key === 'Escape') closeBot() }}>
      <div className="grokbot-panel__head">
        <span style={{ fontSize: 20 }}>{bot.avatar}</span>
        <span className="grokbot-panel__title">{bot.name}</span>
        <span className="grokbot-panel__meta">{bot.status === 'working' ? '工作中…' : '待命'}</span>
        <button className="grokbot-panel__close" type="button" onClick={closeBot} aria-label="关闭">✕</button>
      </div>
      <div className="grokbot-log" ref={logRef}>
        {messages.length === 0
          ? <div className="grokbot-empty">和 {bot.name} 对话，或投递任务给它。<br />它有自己的工作区，会真实执行操作。</div>
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

export function GrokbotOverlay(): ReactNode {
  const openId = useOverlayOpen()
  const state = useGrokbotState()
  const bot = state?.bots.find((entry) => entry.id === openId) ?? null
  if (!bot) return null
  return (
    <div className="grokbot-overlay" onClick={(event) => { if (event.target === event.currentTarget) closeBot() }}>
      <BotChatPanel bot={bot} />
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

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'grokbot-crew',
    order: 6,
  }, GrokbotHomeCrew))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'grokbot-overlay',
    order: 51,
  }, GrokbotOverlay))
}
