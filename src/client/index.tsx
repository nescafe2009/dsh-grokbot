import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

const API_ROOT = '/api/plugins/grokbot'
const POLL_MS = 2000

interface BotInfo {
  id: string
  name: string
  avatar: string
  title: string
  pinned: boolean
  section: string
  hidden: boolean
  status: 'idle' | 'working'
  currentJob: string | null
  lastActivity: number | null
  lastMessage?: string
  lastAt?: number | null
  lastFrom?: string
}

interface ConversationInfo {
  id: string
  name: string
  memberBotIds: string[]
  isGroup?: boolean
  lastMessage?: string
  lastAt?: number | null
  lastFrom?: string
}

interface RoutineInfo {
  id: string
  botId: string
  prompt: string
  schedule: { everyMinutes?: number; time?: string }
  enabled: boolean
}

interface ApprovalInfo {
  id: string
  botId: string
  toolName: string
  reason: string
  createdAt: number
}

interface RoomMessage {
  ts: number
  role: string
  botId?: string
  fromBotId?: string
  toBotId?: string
  text: string
  activity?: string[]
}

interface ChatMessage {
  id: string
  role: 'user' | 'bot' | 'error' | 'activity'
  text: string
  at: number
}

interface GrokbotState {
  lastTarget?: { kind: string; id: string } | null
  bots: BotInfo[]
  conversations: ConversationInfo[]
  routines: RoutineInfo[]
  approvals: ApprovalInfo[]
  running: { jobId: string; botId: string; startedAt: number }[]
  queueDepth: number
  recentJobs: { jobId: string; botId: string; status: string; endedAt: number | null }[]
}

interface CatalogProvider {
  id: string
  name: string
  models: { id: string; name: string }[]
}

const GROKBOT_CSS = `
.grokbot-sidebar { display:flex; flex-direction:column; min-height:0; flex:1; }
.grokbot-sidebar__top { display:flex; align-items:center; justify-content:flex-end; gap:4px; padding:20px 10px 6px; }
.grokbot-iconbtn { border:none; background:none; cursor:pointer; opacity:.55; font-size:15px; padding:3px 7px; border-radius:7px; line-height:1; }
.grokbot-iconbtn:hover { opacity:1; background:rgba(127,127,127,.14); }
.grokbot-sidebar__search { margin:2px 10px 8px; }
.grokbot-sidebar__search input { width:100%; box-sizing:border-box; border:none; border-radius:8px; background:rgba(127,127,127,.12); padding:7px 12px; font:inherit; font-size:12.5px; color:inherit; outline:none; }
.grokbot-sidebar__search input::placeholder { opacity:.5; }
.grokbot-newchat { margin:0 10px 10px; border:none; border-radius:9px; background:rgba(59,130,246,.14); color:inherit; padding:8px 0; font:inherit; font-size:13px; font-weight:600; cursor:pointer; }
.grokbot-newchat:hover { background:rgba(59,130,246,.22); }
.grokbot-sidebar__list { flex:1; overflow-y:auto; padding:0 6px 8px; }
.grokbot-sidebar__section { font-size:10.5px; opacity:.45; margin:10px 6px 3px; letter-spacing:.04em; }
.grokbot-chatrow { display:flex; align-items:center; gap:9px; width:100%; padding:7px 8px; border:none; border-radius:10px; background:transparent; cursor:pointer; text-align:left; font:inherit; color:inherit; transition:background .1s; }
.grokbot-chatrow:hover { background:rgba(127,127,127,.10); }
.grokbot-chatrow.active { background:rgba(127,127,127,.16); }
.grokbot-avatar { position:relative; flex:none; }
.grokbot-avatar__circle { width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:17px; background:rgba(127,127,127,.14); }
.grokbot-avatar__dot { position:absolute; right:-1px; bottom:-1px; width:10px; height:10px; border-radius:50%; background:#2ea043; border:2px solid var(--background,#fff); box-sizing:content-box; }
.grokbot-avatar__dot.working { background:#f0883e; animation: grokbot-pulse 1.2s infinite; }
.grokbot-chatrow__main { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
.grokbot-chatrow__line1 { display:flex; align-items:baseline; gap:6px; }
.grokbot-chatrow__name { font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-chatrow__time { margin-left:auto; font-size:10.5px; opacity:.45; flex:none; }
.grokbot-chatrow__preview { font-size:11.5px; opacity:.55; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-sidebar__foot { border-top:1px solid var(--border,#e3e5e8); padding:8px 10px; display:flex; align-items:center; gap:8px; }
.grokbot-sidebar__user { display:flex; align-items:center; gap:7px; flex:1; min-width:0; font-size:12.5px; font-weight:600; opacity:.8; }
.grokbot-sidebar__user .uavatar { width:24px; height:24px; border-radius:50%; background:linear-gradient(135deg,#6366f1,#3b82f6); color:#fff; display:flex; align-items:center; justify-content:center; font-size:12px; }
@keyframes grokbot-pulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }
.grokbot-newmenu { display:flex; flex-direction:column; gap:1px; margin:0 10px 8px; padding:5px; border:1px solid var(--border,#e3e5e8); border-radius:10px; background:var(--background,#fff); box-shadow:0 4px 16px rgba(0,0,0,.08); }
.grokbot-newmenu__item { display:flex; align-items:center; gap:8px; width:100%; padding:7px 10px; border:none; border-radius:8px; background:transparent; cursor:pointer; font:inherit; font-size:13px; color:inherit; text-align:left; }
.grokbot-newmenu__item:hover { background:rgba(127,127,127,.12); }
.grokbot-newmenu__icon { width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; font-size:15px; flex:none; }
.grokbot-newmenu__divider { height:1px; background:var(--border,#e3e5e8); margin:4px 2px; }
.grokbot-form { display:flex; flex-direction:column; gap:8px; padding:10px; margin:0 10px 8px; border:1px solid var(--border,#e3e5e8); border-radius:10px; background:rgba(127,127,127,.05); }
.grokbot-form__row { display:flex; gap:6px; }
.grokbot-form input, .grokbot-form textarea, .grokbot-form select { flex:1; min-width:0; border:1px solid var(--border,#d8dbe0); border-radius:8px; padding:6px 9px; font:inherit; font-size:12.5px; background:transparent; color:inherit; }
.grokbot-form textarea { resize:vertical; min-height:52px; }
.grokbot-form__actions { display:flex; gap:6px; justify-content:flex-end; }
.grokbot-form__actions button { border:none; border-radius:8px; padding:5px 12px; font-size:12px; cursor:pointer; font-weight:600; }
.grokbot-form__submit { background:#3b82f6; color:#fff; }
.grokbot-form__cancel { background:rgba(127,127,127,.15); color:inherit; }
.grokbot-chat { width:100%; height:100%; display:flex; flex-direction:column; background:var(--background,#fff); }
.grokbot-chat__head { display:flex; align-items:center; gap:10px; padding:12px 20px; border-bottom:1px solid var(--border,#eceef1); }
.grokbot-chat__avatar { font-size:22px; }
.grokbot-chat__title { flex:1; display:flex; flex-direction:column; min-width:0; cursor:pointer; }
.grokbot-chat__name { font-weight:600; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-chat__meta { font-size:11.5px; opacity:.55; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-chat__stop { border:1px solid #f0988e; background:#fff1f0; color:#cf1322; border-radius:8px; padding:4px 12px; font-size:12px; cursor:pointer; font-weight:600; }
.grokbot-chat__stop:hover { background:#ffdedb; }
.grokbot-chat__close { border:none; background:none; cursor:pointer; opacity:.5; font-size:18px; padding:2px 8px; border-radius:8px; }
.grokbot-chat__close:hover { opacity:1; background:rgba(127,127,127,.12); }
.grokbot-body { flex:1; display:flex; min-height:0; }
.grokbot-log { flex:1; overflow-y:auto; padding:24px 28px; display:flex; flex-direction:column; gap:12px; }
.grokbot-msg { max-width:72%; border-radius:14px; padding:9px 14px; font-size:14px; line-height:1.55; white-space:pre-wrap; word-break:break-word; }
.grokbot-msg.user { align-self:flex-end; background:#ececf1; color:inherit; border-bottom-right-radius:5px; }
.grokbot-msg.bot { align-self:flex-start; background:rgba(127,127,127,.07); border-bottom-left-radius:5px; }
.grokbot-msg.error { align-self:center; background:#fff1f0; color:#cf1322; font-size:12px; }
.grokbot-msg.activity { align-self:center; background:transparent; font-size:11px; opacity:.55; padding:2px 12px; }
.grokbot-msg.approval { align-self:flex-start; border:1px solid #f0c98e; background:#fffaf0; border-radius:12px; padding:10px 14px; }
.grokbot-approval__title { font-size:13px; font-weight:600; margin-bottom:3px; }
.grokbot-approval__reason { font-size:12px; opacity:.7; margin-bottom:9px; white-space:pre-wrap; }
.grokbot-approval__actions { display:flex; gap:8px; }
.grokbot-approval__actions button { border:none; border-radius:8px; padding:5px 16px; font-size:12.5px; font-weight:600; cursor:pointer; }
.grokbot-approval__ok { background:#2ea043; color:#fff; }
.grokbot-approval__no { background:rgba(127,127,127,.15); color:inherit; }
.grokbot-md__p { white-space:pre-wrap; }
.grokbot-md__h1, .grokbot-md__h2, .grokbot-md__h3, .grokbot-md__h4 { font-weight:700; margin:6px 0 2px; }
.grokbot-md__h1 { font-size:16px; } .grokbot-md__h2 { font-size:15px; } .grokbot-md__h3 { font-size:14px; } .grokbot-md__h4 { font-size:13px; }
.grokbot-md__ul { margin:2px 0; padding-left:18px; }
.grokbot-md__quote { border-left:3px solid rgba(127,127,127,.3); margin:4px 0; padding:2px 10px; opacity:.85; }
.grokbot-md__hr { border:none; border-top:1px solid rgba(127,127,127,.25); margin:8px 0; }
.grokbot-md__spacer { height:6px; }
.grokbot-md__icode { background:rgba(127,127,127,.15); border-radius:5px; padding:1px 5px; font-size:12.5px; font-family:ui-monospace,Menlo,monospace; }
.grokbot-md__link { color:#3b82f6; text-decoration:none; }
.grokbot-md__link:hover { text-decoration:underline; }
.grokbot-code { align-self:stretch; max-width:100%; border:1px solid var(--border,#e3e5e8); border-radius:10px; overflow:hidden; margin:4px 0; background:rgba(127,127,127,.05); }
.grokbot-code__bar { display:flex; align-items:center; justify-content:space-between; padding:4px 10px; border-bottom:1px solid var(--border,#eceef1); font-size:11px; }
.grokbot-code__lang { opacity:.55; text-transform:uppercase; letter-spacing:.05em; font-family:ui-monospace,Menlo,monospace; }
.grokbot-code__actions { display:flex; gap:8px; }
.grokbot-code__actions button { border:none; background:none; cursor:pointer; font-size:11px; color:#3b82f6; padding:2px 4px; }
.grokbot-code__pre { margin:0; padding:10px 12px; overflow-x:auto; font-family:ui-monospace,Menlo,monospace; font-size:12.5px; line-height:1.5; white-space:pre; }
.grokbot-code__pre.collapsed { display:none; }
.grokbot-code__peek { border:none; background:none; cursor:pointer; text-align:left; padding:8px 12px; font-family:ui-monospace,Menlo,monospace; font-size:12px; opacity:.6; width:100%; }
.grokbot-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.grokbot-chips__item { border:1px solid rgba(59,130,246,.5); background:rgba(59,130,246,.08); color:#3b82f6; border-radius:14px; padding:4px 14px; font-size:12.5px; cursor:pointer; font-weight:600; }
.grokbot-chips__item:hover { background:rgba(59,130,246,.18); }
.grokbot-chips__item:disabled { opacity:.45; cursor:default; }
.grokbot-msg .grokbot-msg__time { display:block; font-size:10px; opacity:.45; margin-top:4px; text-align:inherit; }
.grokbot-blank { flex:1; background:var(--background,#fff); }
.grokbot-creating { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; font-size:13.5px; opacity:.75; }
.grokbot-creating__spinner { width:26px; height:26px; border-radius:50%; border:3px solid rgba(59,130,246,.25); border-top-color:#3b82f6; animation:grokbot-spin .8s linear infinite; }
@keyframes grokbot-spin { to { transform:rotate(360deg) } }
.grokbot-empty { margin:auto; text-align:center; opacity:.5; font-size:13px; }
.grokbot-details { width:264px; flex:none; border-left:1px solid var(--border,#eceef1); overflow-y:auto; padding:14px 14px 20px; display:flex; flex-direction:column; gap:14px; }
.grokbot-details__title { font-size:12px; font-weight:700; opacity:.55; letter-spacing:.04em; }
.grokbot-member { display:flex; align-items:center; gap:9px; padding:6px 4px; font-size:13px; }
.grokbot-member .mavatar { width:28px; height:28px; border-radius:50%; background:rgba(127,127,127,.14); display:flex; align-items:center; justify-content:center; font-size:14px; }
.grokbot-details__hint { font-size:11.5px; opacity:.5; padding:4px 4px 0; }
.grokbot-routine { border:1px solid var(--border,#eceef1); border-radius:10px; padding:8px 10px; font-size:12px; }
.grokbot-routine__prompt { opacity:.8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-routine__sched { font-size:11px; opacity:.5; margin-top:2px; }
.grokbot-details__new { border:1px dashed var(--border,#d8dbe0); border-radius:10px; background:transparent; color:inherit; padding:7px; font-size:12.5px; cursor:pointer; width:100%; }
.grokbot-details__new:hover { background:rgba(127,127,127,.06); }
.grokbot-inputbar { display:flex; align-items:flex-end; gap:4px; padding:12px 18px 16px; }
.grokbot-inputbar textarea { flex:1; resize:none; border:1px solid var(--border,#d8dbe0); border-radius:12px; padding:10px 14px; font:inherit; font-size:13.5px; min-height:44px; max-height:150px; background:transparent; color:inherit; }
.grokbot-inputbar textarea:focus { outline:2px solid rgba(59,130,246,.35); }
.grokbot-inputbar .side { border:none; background:none; cursor:pointer; opacity:.5; font-size:17px; padding:6px 9px; border-radius:9px; }
.grokbot-inputbar .side:hover { opacity:.9; background:rgba(127,127,127,.12); }
.grokbot-inputbar .side:disabled { opacity:.25; cursor:default; }
`

let openTarget: { kind: 'conversation'; id: string } | null = null
let creatingUi = false
let nativeSidebarVisible = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function setCreatingUi(value: boolean): void {
  creatingUi = value
  notify()
}

function persistLastTarget(target: { kind: string; id: string }): void {
  // 存服务端：DSH 每次启动端口变化，localStorage 按 origin 隔离不可用
  void fetch(`${API_ROOT}/ui-state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(target),
  }).catch(() => undefined)
}

// 统一实体：私聊会话 id === botId；群聊会话 id 独立
function openConversation(conversationId: string): void {
  openTarget = { kind: 'conversation', id: conversationId }
  persistLastTarget(openTarget)
  notify()
  refreshState?.()
}

function openBot(botId: string): void {
  openConversation(botId)
}

function openRoom(roomId: string): void {
  openConversation(roomId)
}

function closeTarget(): void {
  openTarget = null
  notify()
}

function toggleNativeSidebar(): void {
  nativeSidebarVisible = !nativeSidebarVisible
  notify()
}

function useOpenTarget(): { kind: 'conversation'; id: string } | null {
  const [, force] = useState(0)
  useEffect(() => {
    const listener = (): void => force((n) => n + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  return openTarget
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

const histories = new Map<string, ChatMessage[]>()
const loadedHistoryFor = new Set<string>()

function historyOf(botId: string): ChatMessage[] {
  let list = histories.get(botId)
  if (!list) {
    list = []
    histories.set(botId, list)
  }
  return list
}

function appendLocal(botId: string, message: ChatMessage): void {
  historyOf(botId).push(message)
  notify()
}

let refreshState: (() => void) | null = null

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
    refreshState = tick
    const timer = setInterval(tick, POLL_MS)
    return () => {
      alive = false
      refreshState = null
      clearInterval(timer)
    }
  }, [])
  return state
}

function timeLabel(ts: number | null | undefined): string {
  if (!ts) return ''
  const date = new Date(ts)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { weekday: 'short' })
}

/* ---------------- 表单 ---------------- */

let catalogCache: { at: number; providers: CatalogProvider[] } | null = null
async function fetchCatalog(): Promise<CatalogProvider[]> {
  if (catalogCache && Date.now() - catalogCache.at < 60_000) return catalogCache.providers
  const outcome = await api('/model-catalog').catch(() => null)
  const providers = (outcome?.catalog ?? []) as CatalogProvider[]
  catalogCache = { at: Date.now(), providers }
  return providers
}

function BotForm(props: {
  initial?: BotInfo | null
  onCancel: () => void
  onSaved: (bot: BotInfo) => void
}): ReactNode {
  const { initial } = props
  const [avatar, setAvatar] = useState(initial?.avatar ?? '🤖')
  const [name, setName] = useState(initial?.name ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [persona, setPersona] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [providers, setProviders] = useState<CatalogProvider[]>([])
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!advanced || providers.length > 0) return
    void fetchCatalog().then(setProviders).catch(() => undefined)
  }, [advanced, providers.length])

  const submit = useCallback(async (): Promise<void> => {
    if (busy) return
    if (!name.trim()) { setError('名称必填'); return }
    setBusy(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        avatar: avatar.trim() || '🤖',
        title: title.trim(),
      }
      if (persona.trim()) payload.persona = persona.trim()
      if (providerId && modelId) payload.model = { provider: providerId, model: modelId }
      else if (initial && !providerId) payload.model = null
      const outcome = initial
        ? await api(`/bots/${encodeURIComponent(initial.id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api('/bots', { method: 'POST', body: JSON.stringify(payload) })
      props.onSaved(outcome?.bot as BotInfo)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(false)
    }
  }, [avatar, name, title, persona, providerId, modelId, busy, initial, props])

  return (
    <div className="grokbot-form">
      <div className="grokbot-form__row">
        <input style={{ maxWidth: 52, textAlign: 'center' }} value={avatar} onChange={(e) => setAvatar(e.target.value)} aria-label="头像" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称（必填）" aria-label="名称" />
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="头衔，如：检索与情报专家" aria-label="头衔" />
      <textarea value={persona} onChange={(e) => setPersona(e.target.value)} placeholder={initial ? '补充职责/规则（留空不改）' : '职责与持久规则：它负责什么、怎么做事、安全边界'} aria-label="职责" />
      <button type="button" className="grokbot-form__cancel" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced((v) => !v)}>{advanced ? '收起高级设置' : '高级设置（模型）'}</button>
      {advanced
        ? (
          <div className="grokbot-form__row">
            <select value={providerId} onChange={(e) => { setProviderId(e.target.value); setModelId('') }} aria-label="provider">
              <option value="">模型：跟随团队默认</option>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select>
            <select value={modelId} onChange={(e) => setModelId(e.target.value)} aria-label="model" disabled={!providerId}>
              <option value="">选择模型</option>
              {(providers.find((provider) => provider.id === providerId)?.models ?? []).map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </div>
        )
        : null}
      {error ? <span style={{ color: '#cf1322', fontSize: 11.5 }}>{error}</span> : null}
      <div className="grokbot-form__actions">
        <button type="button" className="grokbot-form__cancel" onClick={props.onCancel}>取消</button>
        <button type="button" className="grokbot-form__submit" disabled={busy} onClick={() => void submit()}>{initial ? '保存' : '创建'}</button>
      </div>
    </div>
  )
}

function RoomForm(props: {
  bots: BotInfo[]
  onCancel: () => void
  onSaved: (roomId: string) => void
}): ReactNode {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const toggle = (botId: string): void => {
    setSelected((prev) => prev.includes(botId) ? prev.filter((entry) => entry !== botId) : [...prev, botId])
  }

  const submit = useCallback(async (): Promise<void> => {
    if (busy) return
    if (selected.length < 2) { setError('群聊需要选择 2-6 位成员'); return }
    setBusy(true)
    setError('')
    try {
      const outcome = await api('/conversations', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() || '新群聊', memberBotIds: selected }),
      })
      props.onSaved(String(outcome?.conversation?.id ?? ''))
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(false)
    }
  }, [name, selected, busy, props])

  return (
    <div className="grokbot-form">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="群聊名称（可空）" aria-label="群聊名称" />
      {props.bots.map((bot) => (
        <label key={bot.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto', flex: 'none' }} checked={selected.includes(bot.id)} onChange={() => toggle(bot.id)} />
          <span>{bot.avatar} {bot.name}</span>
        </label>
      ))}
      {error ? <span style={{ color: '#cf1322', fontSize: 11.5 }}>{error}</span> : null}
      <div className="grokbot-form__actions">
        <button type="button" className="grokbot-form__cancel" onClick={props.onCancel}>取消</button>
        <button type="button" className="grokbot-form__submit" disabled={busy} onClick={() => void submit()}>创建群聊</button>
      </div>
    </div>
  )
}

function RoutineForm(props: { botId: string; onCancel: () => void; onSaved: () => void }): ReactNode {
  const [every, setEvery] = useState('60')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = useCallback(async (): Promise<void> => {
    if (busy) return
    const minutes = Number(every)
    if (!Number.isInteger(minutes) || minutes < 1) { setError('间隔分钟数须为正整数'); return }
    if (!prompt.trim()) { setError('要做什么不能为空'); return }
    setBusy(true)
    try {
      await api('/routines', { method: 'POST', body: JSON.stringify({ botId: props.botId, schedule: { everyMinutes: minutes }, prompt: prompt.trim() }) })
      props.onSaved()
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(false)
    }
  }, [every, prompt, busy, props])
  return (
    <div className="grokbot-form">
      <input value={every} onChange={(e) => setEvery(e.target.value)} placeholder="间隔（分钟）" aria-label="间隔分钟" />
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="每次运行做什么？" aria-label="任务" />
      {error ? <span style={{ color: '#cf1322', fontSize: 11.5 }}>{error}</span> : null}
      <div className="grokbot-form__actions">
        <button type="button" className="grokbot-form__cancel" onClick={props.onCancel}>取消</button>
        <button type="button" className="grokbot-form__submit" disabled={busy} onClick={() => void submit()}>创建例行任务</button>
      </div>
    </div>
  )
}

/* ---------------- 侧栏 ---------------- */

export function GrokbotSidebarCrew(): ReactNode {
  const state = useGrokbotState()
  const target = useOpenTarget()
  const nativeVisible = useNativeSidebarVisible()
  const [grouping, setGrouping] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuView, setMenuView] = useState<'main' | 'templates'>('main')
  const [creatingBot, setCreatingBot] = useState(false)
  const [templates, setTemplates] = useState<{ id: string; name: string; avatar: string; title: string; blank?: boolean }[]>([])

  useEffect(() => {
    if (!menuOpen || menuView !== 'templates' || templates.length > 0) return
    void api('/bot-templates').then((outcome) => setTemplates(outcome?.templates ?? [])).catch(() => undefined)
  }, [menuOpen, menuView, templates.length])
  const [filter, setFilter] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const hiddenRef = useRef<HTMLElement[]>([])

  const createFromTemplate = useCallback((templateId: string | null): void => {
    if (creatingBot) return
    setMenuOpen(false)
    setMenuView('main')
    // 进入"召唤中"过渡视图：保持主区接管，既不闪旧会话也不露 DSH 默认页
    openTarget = null
    setCreatingUi(true)
    setCreatingBot(true)
    void api('/bots', { method: 'POST', body: JSON.stringify(templateId ? { templateId } : {}) })
      .then((outcome) => {
        const id = String(outcome?.bot?.id || '')
        if (id) openBot(id)
      })
      .catch(() => undefined)
      .finally(() => {
        setCreatingBot(false)
        setCreatingUi(false)
      })
  }, [creatingBot])
  useEffect(() => {
    if (nativeVisible) return
    const root = rootRef.current
    if (!root) return
    const sidebarCol = root.closest('[class*="sidebarCol"]') as HTMLElement | null
    if (!sidebarCol) return
    // 从侧栏根到我们的根，链上每层隐藏非路径兄弟：去掉 logo 行 / 新会话 / 任务看板 / 底部原生区
    const chain: HTMLElement[] = []
    let node: HTMLElement | null = root
    while (node && node !== sidebarCol) {
      chain.unshift(node)
      node = node.parentElement
    }
    const onPath = new Set<HTMLElement>(chain)
    const apply = (): void => {
      for (const el of chain) {
        const parent = el.parentElement
        if (!parent) continue
        for (const child of [...parent.children]) {
          if (onPath.has(child as HTMLElement) || child.contains(root)) continue
          const target = child as HTMLElement
          if (target.dataset.grokbotPrevDisplay === undefined && target.style.display !== 'none') {
            target.dataset.grokbotPrevDisplay = target.style.display
            target.style.display = 'none'
            hiddenRef.current.push(target)
          }
        }
      }
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(sidebarCol, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      for (const el of hiddenRef.current) {
        el.style.display = el.dataset.grokbotPrevDisplay || ''
        delete el.dataset.grokbotPrevDisplay
      }
      hiddenRef.current = []
    }
  }, [nativeVisible])

  const allBots = state?.bots ?? []
  const botOf = (botId: string): BotInfo | undefined => allBots.find((bot) => bot.id === botId)
  const routines = state?.routines ?? []

  // 统一实体：一个会话一行（dm=成员 bot 档案；群=成员名列表）
  const conversations = (state?.conversations ?? [])
    .filter((conversation) => conversation.memberBotIds.every((botId) => botOf(botId) && !botOf(botId)!.hidden))
    .filter((conversation) => {
      if (!filter.trim()) return true
      const label = conversation.memberBotIds.length > 1
        ? (conversation.name || conversation.memberBotIds.map((botId) => botOf(botId)?.name ?? botId).join('、'))
        : (botOf(conversation.memberBotIds[0])?.name ?? '')
      return label.includes(filter.trim())
    })
    .sort((a, b) => {
      const pinnedOf = (conversation: ConversationInfo) => (conversation.memberBotIds.length === 1 ? Number(botOf(conversation.memberBotIds[0])?.pinned ?? false) : 0)
      return pinnedOf(b) - pinnedOf(a) || (b.lastAt ?? 0) - (a.lastAt ?? 0)
    })

  const rowTitle = (conversation: ConversationInfo): string => conversation.memberBotIds.length > 1
    ? (conversation.name || conversation.memberBotIds.map((botId) => botOf(botId)?.name ?? botId).join('、'))
    : (botOf(conversation.memberBotIds[0])?.name ?? conversation.id)

  const rowPreview = (conversation: ConversationInfo): string => {
    if (conversation.memberBotIds.length === 1) {
      const bot = botOf(conversation.memberBotIds[0])
      if (bot?.status === 'working') return `工作中${bot.currentJob ? ` · ${bot.currentJob}` : ''}`
      if (conversation.lastMessage) return `${conversation.lastFrom === 'user' ? '我: ' : ''}${conversation.lastMessage}`
      return bot?.title || '待命'
    }
    if (conversation.lastMessage) return `${conversation.lastFrom === 'user' ? '我: ' : ''}${conversation.lastMessage}`
    return `${conversation.memberBotIds.length} 位成员`
  }

  return (
    <div className="grokbot-sidebar" ref={rootRef}>
      <div className="grokbot-sidebar__top">
        <button type="button" className="grokbot-iconbtn" title="新建：召唤专家 / 拉群聊 / 与 Bot 单聊" onClick={() => { setMenuOpen((v) => !v); setMenuView('main') }}>＋</button>
        <button type="button" className="grokbot-iconbtn" title={nativeVisible ? '隐藏原始列表' : '显示原始工作区/会话列表'} onClick={() => toggleNativeSidebar()}>⇆</button>
      </div>
      <div className="grokbot-sidebar__search">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="搜索" aria-label="搜索" />
      </div>
      <div className="grokbot-sidebar__list">
        {menuOpen
          ? (
            <div className="grokbot-newmenu">
              {menuView === 'templates'
                ? (
                  <>
                    <button type="button" className="grokbot-newmenu__item" onClick={() => setMenuView('main')}>
                      <span className="grokbot-newmenu__icon">‹</span>返回
                    </button>
                    <div className="grokbot-newmenu__divider" />
                    {templates.length === 0 ? <div style={{ fontSize: 12, opacity: .5, padding: '4px 10px' }}>加载预设…</div> : null}
                    {templates.map((template) => (
                      <button key={template.id} type="button" className="grokbot-newmenu__item" disabled={creatingBot} onClick={() => createFromTemplate(template.id)} title={template.title}>
                        <span className="grokbot-newmenu__icon">{template.avatar}</span>
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span style={{ fontWeight: 600 }}>{template.name}</span>
                          <span style={{ fontSize: 11, opacity: .55 }}>{template.title}</span>
                        </span>
                      </button>
                    ))}
                  </>
                )
                : (
                  <>
                    <button type="button" className="grokbot-newmenu__item" disabled={creatingBot} onClick={() => setMenuView('templates')}>
                      <span className="grokbot-newmenu__icon">✨</span>
                      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{creatingBot ? '正在创建…' : '创建新 Bot'}</span>
                        <span style={{ fontSize: 11, opacity: .55 }}>10 个预设专家 · 或对话式定制</span>
                      </span>
                    </button>
                    <button type="button" className="grokbot-newmenu__item" onClick={() => { setMenuOpen(false); setGrouping(true) }}>
                      <span className="grokbot-newmenu__icon">👥</span>创建群聊
                    </button>
                    {allBots.filter((bot) => !bot.hidden).length > 0 ? <div className="grokbot-newmenu__divider" /> : null}
                    {allBots.filter((bot) => !bot.hidden).map((bot) => (
                      <button key={bot.id} type="button" className="grokbot-newmenu__item" onClick={() => { setMenuOpen(false); openBot(bot.id) }}>
                        <span className="grokbot-newmenu__icon">{bot.avatar}</span>{bot.name}
                      </button>
                    ))}
                  </>
                )}
            </div>
          )
          : null}
        {grouping ? <RoomForm bots={allBots.filter((bot) => !bot.hidden)} onCancel={() => setGrouping(false)} onSaved={(roomId) => { setGrouping(false); openRoom(roomId) }} /> : null}
        <div className="grokbot-sidebar__section">会话</div>
        {conversations.length === 0 ? <div style={{ fontSize: 12, opacity: .5, padding: '4px 10px' }}>暂无会话，点 ＋ 开始</div> : null}
        {conversations.map((conversation) => {
          const isGroup = conversation.memberBotIds.length > 1
          const bot = isGroup ? undefined : botOf(conversation.memberBotIds[0])
          const working = !isGroup && bot?.status === 'working'
          return (
            <button key={conversation.id} type="button" className={`grokbot-chatrow${target?.id === conversation.id ? ' active' : ''}`} onClick={() => openConversation(conversation.id)}>
              <span className="grokbot-avatar">
                <span className="grokbot-avatar__circle">{isGroup ? '👥' : (bot?.avatar ?? '🤖')}</span>
                {!isGroup ? <span className={`grokbot-avatar__dot${working ? ' working' : ''}`} /> : null}
              </span>
              <span className="grokbot-chatrow__main">
                <span className="grokbot-chatrow__line1">
                  <span className="grokbot-chatrow__name">{rowTitle(conversation)}</span>
                  <span className="grokbot-chatrow__time">{timeLabel(conversation.lastAt)}</span>
                </span>
                <span className="grokbot-chatrow__preview">{rowPreview(conversation)}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="grokbot-sidebar__foot">
        <span className="grokbot-sidebar__user"><span className="uavatar">B</span>bo zhao</span>
        <button type="button" className="grokbot-iconbtn" title={routines.length > 0 ? `${routines.length} 个例行任务` : '例行任务'}>⏱</button>
      </div>
    </div>
  )
}

/* ---------------- 私聊视图 ---------------- */


/* ---------------- 消息内可视化组件 ---------------- */

let mdKeySeed = 0
function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)]+)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = match[0]
    const key = `i${mdKeySeed++}`
    if (token.startsWith('**')) {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      parts.push(<code key={key} className="grokbot-md__icode">{token.slice(1, -1)}</code>)
    } else if (token.startsWith('[')) {
      const link = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(token)
      if (link) parts.push(<a key={key} href={link[2]} target="_blank" rel="noreferrer" className="grokbot-md__link">{link[1]}</a>)
      else parts.push(token)
    } else {
      parts.push(<a key={key} href={token} target="_blank" rel="noreferrer" className="grokbot-md__link">{token.length > 48 ? `${token.slice(0, 45)}…` : token}</a>)
    }
    last = match.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function MarkdownText(props: { text: string }): ReactNode {
  const lines = props.text.split('\n')
  const out: ReactNode[] = []
  let list: string[] = []
  const flushList = (): void => {
    if (list.length === 0) return
    out.push(<ul key={`l${mdKeySeed++}`} className="grokbot-md__ul">{list.map((item, i) => <li key={i}>{renderInline(item)}</li>)}</ul>)
    list = []
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    const ordered = /^(\d+)[.、)]\s+(.*)$/.exec(line)
    const quote = /^>\s?(.*)$/.exec(line)
    if (bullet) { list.push(bullet[1]); continue }
    if (ordered) { list.push(`${ordered[1]}. ${ordered[2]}`); continue }
    flushList()
    if (!line.trim()) { out.push(<div key={`s${mdKeySeed++}`} className="grokbot-md__spacer" />); continue }
    if (heading) {
      const level = heading[1].length
      out.push(<div key={`h${mdKeySeed++}`} className={`grokbot-md__h${level}`}>{renderInline(heading[2])}</div>)
    } else if (quote) {
      out.push(<blockquote key={`q${mdKeySeed++}`} className="grokbot-md__quote">{renderInline(quote[1])}</blockquote>)
    } else if (/^---+$/.test(line.trim())) {
      out.push(<hr key={`r${mdKeySeed++}`} className="grokbot-md__hr" />)
    } else {
      out.push(<div key={`p${mdKeySeed++}`} className="grokbot-md__p">{renderInline(line)}</div>)
    }
  }
  flushList()
  return <>{out}</>
}

function CodeBlock(props: { code: string; lang: string }): ReactNode {
  const lines = props.code.replace(/\n$/, '').split('\n')
  const long = lines.length > 14
  const [collapsed, setCollapsed] = useState(long)
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* 无剪贴板权限 */ }
  }, [props.code])
  return (
    <div className="grokbot-code">
      <div className="grokbot-code__bar">
        <span className="grokbot-code__lang">{props.lang || 'text'}</span>
        <div className="grokbot-code__actions">
          {long
            ? <button type="button" onClick={() => setCollapsed((v) => !v)}>{collapsed ? `展开 ${lines.length} 行` : '折叠'}</button>
            : null}
          <button type="button" onClick={() => void copy()}>{copied ? '已复制 ✓' : '复制'}</button>
        </div>
      </div>
      <pre className={`grokbot-code__pre${collapsed ? ' collapsed' : ''}`}>{collapsed ? '' : props.code.replace(/\n$/, '')}</pre>
      {collapsed ? <button type="button" className="grokbot-code__peek" onClick={() => setCollapsed(false)}>{props.code.split('\n').slice(0, 3).join('\n').slice(0, 120)}…</button> : null}
    </div>
  )
}

function MarkdownView(props: { text: string }): ReactNode {
  const segments = props.text.split(/```/)
  return (
    <>
      {segments.map((segment, index) => {
        if (index % 2 === 1) {
          const body = segment.replace(/^\n/, '')
          const lang = /^[a-zA-Z0-9_+-]*\n/.exec(body)?.[0]?.trim() || ''
          const code = lang ? body.slice(lang.length) : body
          return <CodeBlock key={`c${index}`} code={code} lang={lang} />
        }
        return <MarkdownText key={`t${index}`} text={segment} />
      })}
    </>
  )
}

function splitChips(text: string): { body: string; chips: string[] } {
  const match = /\n?\[\[([^\]\n]+)\]\]\s*$/.exec(text)
  if (!match) return { body: text, chips: [] }
  return {
    body: text.slice(0, match.index),
    chips: match[1].split('|').map((entry) => entry.trim()).filter(Boolean).slice(0, 6),
  }
}

function MembersPanel(props: { conversation: { id: string; name: string; memberBotIds: string[] }; bots: BotInfo[]; onChanged: () => void }): ReactNode {
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const { conversation, bots } = props
  const members = conversation.memberBotIds
    .map((botId) => bots.find((bot) => bot.id === botId))
    .filter(Boolean) as BotInfo[]
  const candidates = bots.filter((bot) => !bot.hidden && !conversation.memberBotIds.includes(bot.id))

  const mutate = useCallback(async (botId: string, remove: boolean): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await api(`/conversations/${encodeURIComponent(conversation.id)}/members`, {
        method: 'POST',
        body: JSON.stringify(remove ? { botId, remove: true } : { botId }),
      })
      props.onChanged()
    } catch { /* 错误随轮询消失 */ } finally {
      setBusy(false)
    }
  }, [busy, conversation.id, props])

  return (
    <div>
      <div className="grokbot-details__title">成员</div>
      {members.map((member) => (
        <div key={member.id} className="grokbot-member" style={{ justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span className="mavatar">{member.avatar}</span>{member.name}
          </span>
          {members.length > 1 ? (
            <button type="button" className="grokbot-iconbtn" title="移出会话" disabled={busy} onClick={() => void mutate(member.id, true)}>✕</button>
          ) : null}
        </div>
      ))}
      {adding
        ? (
          <div className="grokbot-form" style={{ margin: '6px 0 0' }}>
            {candidates.length === 0 ? <div style={{ fontSize: 12, opacity: .55 }}>没有可添加的 Bot（先创建更多专家）</div> : null}
            {candidates.map((candidate) => (
              <button key={candidate.id} type="button" className="grokbot-newmenu__item" disabled={busy} onClick={() => { setAdding(false); void mutate(candidate.id, false) }}>
                <span className="grokbot-newmenu__icon">{candidate.avatar}</span>{candidate.name}
              </button>
            ))}
            <button type="button" className="grokbot-form__cancel" onClick={() => setAdding(false)}>取消</button>
          </div>
        )
        : <button type="button" className="grokbot-details__new" disabled={busy} onClick={() => setAdding(true)}>＋ 添加成员（即成群聊）</button>}
      <div className="grokbot-details__hint">添加成员后本会话即成为群聊，历史自动保留。</div>
    </div>
  )
}

function ApprovalCard(props: { approval: ApprovalInfo }): ReactNode {
  const [busy, setBusy] = useState(false)
  const decide = useCallback(async (outcome: 'allowed-once' | 'rejected') => {
    if (busy) return
    setBusy(true)
    try {
      await api(`/approvals/${encodeURIComponent(props.approval.id)}`, { method: 'POST', body: JSON.stringify({ outcome }) })
    } catch { /* 已失效则随轮询消失 */ } finally {
      setBusy(false)
    }
  }, [busy, props])
  return (
    <div className="grokbot-msg approval">
      <div className="grokbot-approval__title">🛡️ 需要审批：{props.approval.toolName || '工具操作'}</div>
      {props.approval.reason ? <div className="grokbot-approval__reason">{props.approval.reason}</div> : null}
      <div className="grokbot-approval__actions">
        <button type="button" className="grokbot-approval__ok" disabled={busy} onClick={() => void decide('allowed-once')}>同意</button>
        <button type="button" className="grokbot-approval__no" disabled={busy} onClick={() => void decide('rejected')}>取消</button>
      </div>
    </div>
  )
}

function BotChatView(props: { bot: BotInfo; state: GrokbotState | null }): ReactNode {
  const { bot, state } = props
  const propsBots = state?.bots ?? []
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [newRoutine, setNewRoutine] = useState(false)
  const [historyRefresh, forceRefresh] = useState(0)
  const logRef = useRef<HTMLDivElement | null>(null)
  const messages = useMemo(() => historyOf(bot.id), [bot.id, sending, historyRefresh])
  const pending = (state?.approvals ?? []).filter((approval) => approval.botId === bot.id)

  useEffect(() => {
    if (loadedHistoryFor.has(bot.id) || histories.get(bot.id)?.length) return
    loadedHistoryFor.add(bot.id)
    void api(`/conversations/${encodeURIComponent(bot.id)}`).then((outcome) => {
      const list = (outcome?.messages ?? []) as { ts: number; role: string; text: string }[]
      if (list.length === 0 || histories.get(bot.id)?.length) return
      histories.set(bot.id, list.map((message, index) => message.role === 'user'
        ? { id: `h${index}`, role: 'user' as const, text: message.text, at: message.ts }
        : { id: `h${index}`, role: 'bot' as const, text: message.text, at: message.ts }))
      forceRefresh((n) => n + 1)
    }).catch(() => undefined)
  }, [bot.id])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages.length, sending, pending.length])

  const stop = useCallback(async (): Promise<void> => {
    await api(`/bots/${encodeURIComponent(bot.id)}/stop`, { method: 'POST' }).catch(() => undefined)
  }, [bot.id])

  const send = useCallback(async (overrideText?: string): Promise<void> => {
    const text = (overrideText ?? draft).trim()
    if (!text || sending) return
    setDraft('')
    appendLocal(bot.id, { id: `${Date.now()}-u`, role: 'user', text, at: Date.now() })
    setSending(true)
    try {
      const outcome = await api(`/conversations/${encodeURIComponent(bot.id)}/chat`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      const activity = (outcome?.activity ?? []) as string[]
      if (activity.length > 0) {
        const counted = activity.reduce<Record<string, number>>((acc, name) => {
          acc[name] = (acc[name] ?? 0) + 1
          return acc
        }, {})
        appendLocal(bot.id, {
          id: `${Date.now()}-a`,
          role: 'activity' as const,
          text: Object.entries(counted).map(([name, count]) => `🔧 ${name}${count > 1 ? ` ×${count}` : ''}`).join('　'),
          at: Date.now(),
        })
      }
      appendLocal(bot.id, { id: `${Date.now()}-b`, role: 'bot', text: String(outcome?.reply ?? ''), at: Date.now() })
    } catch (error) {
      appendLocal(bot.id, {
        id: `${Date.now()}-e`,
        role: 'error' as const,
        text: String((error as Error)?.message ?? error),
        at: Date.now(),
      })
    } finally {
      setSending(false)
    }
  }, [draft, sending, bot.id])

  const routines = (state?.routines ?? []).filter((routine) => routine.botId === bot.id)

  return (
    <div className="grokbot-chat" onKeyDown={(event) => { if (event.key === 'Escape' && !detailsOpen && !editing) closeTarget() }}>
      <div className="grokbot-chat__head">
        <span className="grokbot-chat__avatar">{bot.avatar}</span>
        <span className="grokbot-chat__title" onClick={() => setDetailsOpen((v) => !v)}>
          <span className="grokbot-chat__name">{bot.name}</span>
          <span className="grokbot-chat__meta">
            {bot.status === 'working' ? '正在执行任务…' : (bot.title || '常驻待命')}
          </span>
        </span>
        {sending
          ? <button type="button" className="grokbot-chat__stop" onClick={() => void stop()}>停止</button>
          : null}
        <button type="button" className="grokbot-iconbtn" title="编辑资料" onClick={() => setEditing((v) => !v)}>⚙</button>
        <button type="button" className="grokbot-chat__close" onClick={closeTarget} aria-label="关闭">✕</button>
      </div>
      {editing ? <div style={{ padding: '0 20px' }}><BotForm initial={bot} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} /></div> : null}
      <div className="grokbot-body">
        <div className="grokbot-log" ref={logRef}>
          {messages.length === 0 && pending.length === 0
            ? <div className="grokbot-empty">和 {bot.name} 对话，或投递任务给它。<br />它会真实使用工具、在团队共享电脑里干活。</div>
            : null}
          {messages.map((message) => {
            if (message.role === 'bot') {
              const { body, chips } = splitChips(message.text)
              return (
                <div key={message.id} className="grokbot-msg bot">
                  <strong style={{ display: 'block', fontSize: 11.5, opacity: .55, marginBottom: 2 }}>{bot.avatar} {bot.name}</strong>
                  <MarkdownView text={body} />
                  {chips.length > 0
                    ? (
                      <div className="grokbot-chips">
                        {chips.map((chip) => (
                          <button key={chip} type="button" className="grokbot-chips__item" disabled={sending} onClick={() => void send(chip)}>{chip}</button>
                        ))}
                      </div>
                    )
                    : null}
                  <span className="grokbot-msg__time">{new Date(message.at).toLocaleTimeString()}</span>
                </div>
              )
            }
            return (
              <div key={message.id} className={`grokbot-msg ${message.role}`}>
                {message.text}
                <span className="grokbot-msg__time">{new Date(message.at).toLocaleTimeString()}</span>
              </div>
            )
          })}
          {pending.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
          {sending && pending.length === 0 ? <div className="grokbot-empty">思考中…</div> : null}
        </div>
        {detailsOpen
          ? (
            <div className="grokbot-details">
              <MembersPanel conversation={{ id: bot.id, name: bot.name, memberBotIds: [bot.id] }} bots={propsBots} onChanged={() => refreshState?.()} />
              <div>
                <div className="grokbot-details__title">例行任务</div>
                {routines.map((routine) => (
                  <div key={routine.id} className="grokbot-routine" style={{ marginBottom: 6 }}>
                    <div className="grokbot-routine__prompt">{routine.prompt}</div>
                    <div className="grokbot-routine__sched">
                      {routine.schedule.everyMinutes ? `每 ${routine.schedule.everyMinutes} 分钟` : `每天 ${routine.schedule.time}`}
                      {' · '}{routine.enabled ? '启用' : '停用'}
                    </div>
                  </div>
                ))}
                {newRoutine
                  ? <RoutineForm botId={bot.id} onCancel={() => setNewRoutine(false)} onSaved={() => setNewRoutine(false)} />
                  : <button type="button" className="grokbot-details__new" onClick={() => setNewRoutine(true)}>＋ 创建例行任务</button>}
                <div className="grokbot-details__hint">例行任务让这个 Bot 按时间表定期运行。</div>
              </div>
            </div>
          )
          : null}
      </div>
      <div className="grokbot-inputbar">
        <button type="button" className="side" title="附件（待实现）" disabled>＋</button>
        <textarea
          value={draft}
          placeholder={`发消息给 ${bot.name}`}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <button type="button" className="side" title="语音输入（待实现）" disabled>🎤</button>
      </div>
    </div>
  )
}

/* ---------------- 群聊视图 ---------------- */

function GroupChatView(props: { conversation: ConversationInfo; bots: BotInfo[] }): ReactNode {
  const room = { id: props.conversation.id, name: props.conversation.name || props.conversation.memberBotIds.map((botId) => props.bots.find((bot) => bot.id === botId)?.name ?? botId).join('、'), memberBotIds: props.conversation.memberBotIds }
  const bots = props.bots
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    const tick = (): void => {
      api(`/conversations/${encodeURIComponent(room.id)}`).then((outcome) => {
        if (alive) setMessages((outcome?.messages ?? []) as RoomMessage[])
      }).catch(() => undefined)
    }
    tick()
    const timer = setInterval(tick, 3000)
    return () => { alive = false; clearInterval(timer) }
  }, [room.id])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages.length, sending])

  const botOf = (botId?: string): BotInfo | undefined => bots.find((bot) => bot.id === botId)

  const send = useCallback(async (): Promise<void> => {
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')
    setSending(true)
    try {
      const outcome = await api(`/conversations/${encodeURIComponent(room.id)}/chat`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      setMessages(((outcome?.messages ?? []) as RoomMessage[]).slice())
    } catch (error) {
      setMessages((prev) => [...prev, { ts: Date.now(), role: 'system', text: `发送失败：${String((error as Error)?.message ?? error)}` }])
    } finally {
      setSending(false)
    }
  }, [draft, sending, room.id])

  return (
    <div className="grokbot-chat" onKeyDown={(event) => { if (event.key === 'Escape' && !detailsOpen) closeTarget() }}>
      <div className="grokbot-chat__head">
        <span className="grokbot-chat__avatar">👥</span>
        <span className="grokbot-chat__title" onClick={() => setDetailsOpen((v) => !v)}>
          <span className="grokbot-chat__name">{room.name}</span>
          <span className="grokbot-chat__meta">
            {room.memberBotIds.map((botId) => `${botOf(botId)?.avatar ?? '🤖'}${botOf(botId)?.name ?? botId}`).join('　')}
          </span>
        </span>
        <button type="button" className="grokbot-chat__close" onClick={closeTarget} aria-label="关闭">✕</button>
      </div>
      <div className="grokbot-body">
      <div className="grokbot-log" ref={logRef}>
        {messages.length === 0
          ? <div className="grokbot-empty">群聊成员会自主决定谁应答；@成员名 可定向，bot 之间也会互相转交。</div>
          : messages.map((message, index) => {
              if (message.role === 'user') {
                return (
                  <div key={index} className="grokbot-msg user">
                    {message.text}
                    <span className="grokbot-msg__time">{new Date(message.ts).toLocaleTimeString()}</span>
                  </div>
                )
              }
              if (message.role === 'handoff') {
                return (
                  <div key={index} className="grokbot-msg activity">
                    ↪ {botOf(message.fromBotId)?.name ?? message.fromBotId} → {botOf(message.toBotId)?.name ?? message.toBotId}：{message.text}
                  </div>
                )
              }
              if (message.role === 'system') {
                return <div key={index} className="grokbot-msg activity">{message.text}</div>
              }
              const bot = botOf(message.botId)
              return (
                <div key={index} className="grokbot-msg bot">
                  <strong style={{ display: 'block', fontSize: 11.5, opacity: .55, marginBottom: 2 }}>{bot?.avatar ?? ''}{bot?.name ?? message.botId}</strong>
                  <MarkdownView text={splitChips(message.text).body} />
                  <span className="grokbot-msg__time">{new Date(message.ts).toLocaleTimeString()}</span>
                </div>
              )
            })}
        {sending ? <div className="grokbot-empty">成员思考中…</div> : null}
      </div>
      <div className="grokbot-inputbar">
        <button type="button" className="side" title="附件（待实现）" disabled>＋</button>
        <textarea
          value={draft}
          placeholder={`发到 ${room.name}…（@成员名 定向）`}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <button type="button" className="side" title="语音输入（待实现）" disabled>🎤</button>
      </div>
      </div>
      {detailsOpen
        ? (
          <div className="grokbot-details">
            <MembersPanel conversation={{ id: room.id, name: room.name, memberBotIds: room.memberBotIds }} bots={bots} onChanged={() => refreshState?.()} />
          </div>
        )
        : null}
    </div>
  )
}

/* ---------------- 主区接管 ---------------- */

export function GrokbotMainView(): ReactNode {
  const target = useOpenTarget()
  const state = useGrokbotState()
  const nativeVisible = useNativeSidebarVisible()
  const [, forceCreating] = useState(0)
  const restoredRef = useRef(false)

  useEffect(() => {
    const listener = (): void => forceCreating((n) => n + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])

  // 启动恢复上次会话（Grok Bot 语义）：lastTarget 存于服务端，校验存在性
  useEffect(() => {
    if (restoredRef.current || openTarget || !state) return
    const saved = state.lastTarget
    if (!saved) { restoredRef.current = true; return }
    const savedId = saved.id
    const known = state.conversations?.some((conversation) => conversation.id === savedId)
      || (saved.kind === 'bot' && state.bots.some((bot) => bot.id === savedId))
    if (known) {
      restoredRef.current = true
      openConversation(savedId)
    }
  }, [state])
  const conversation = state?.conversations?.find((entry) => entry.id === target?.id) ?? null
  const isGroup = Boolean(conversation && conversation.memberBotIds.length > 1)
  const bot = !isGroup && conversation
    ? (state?.bots.find((entry) => entry.id === conversation.memberBotIds[0]) ?? null)
    : null
  // 常驻接管：无会话时渲染自家空白页，DSH 默认首页（探索未知之境）任何情况下不再出现；
  // ⇆ 切回原生模式时释放接管。activeKey 只依赖 target，不因轮询未到位而卸载。
  const activeKey = nativeVisible
    ? null
    : (target ? `conversation:${target.id}` : (creatingUi ? 'creating' : 'home'))
  const entering = Boolean(target) && !conversation
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const hiddenRef = useRef<HTMLElement[]>([])

  useEffect(() => {
    hiddenRef.current = []
    if (!activeKey) return
    const center = (document.querySelector('[class*="centerCol"]') as HTMLElement) ?? null
    const details = (document.querySelector('[class*="detailsCol"]') as HTMLElement) ?? null
    if (!center) return
    const takeover = (): void => {
      const rect = center.getBoundingClientRect()
      setBox({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    }
    const hide = (el: HTMLElement | null): void => {
      if (!el || el.dataset.grokbotPrevDisplay !== undefined) return
      el.dataset.grokbotPrevDisplay = el.style.display
      el.style.display = 'none'
      hiddenRef.current.push(el)
    }
    for (const child of [...center.children]) hide(child as HTMLElement)
    hide(details)
    takeover()
    const observer = new ResizeObserver(takeover)
    observer.observe(center)
    window.addEventListener('resize', takeover)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', takeover)
      for (const el of hiddenRef.current) {
        el.style.display = el.dataset.grokbotPrevDisplay || ''
        delete el.dataset.grokbotPrevDisplay
      }
      hiddenRef.current = []
      setBox(null)
    }
  }, [activeKey])

  if (!box || !activeKey) return null
  return (
    <div
      className="grokbot-chat grokbot-chat--main"
      style={{ position: 'fixed', left: box.left, top: box.top, width: box.width, height: box.height, zIndex: 900 }}
    >
      {(() => {
        if (bot) return <BotChatView bot={bot} state={state} />
        if (conversation && isGroup) return <GroupChatView conversation={conversation} bots={state?.bots ?? []} />
        if (creatingUi || entering) {
          return (
            <div className="grokbot-creating">
              <div className="grokbot-creating__spinner" />
              <div>{entering ? '正在进入会话…' : '正在召唤专家…'}</div>
            </div>
          )
        }
        return <div className="grokbot-blank" />
      })()}
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
    id: 'grokbot-main',
    order: 51,
  }, GrokbotMainView))
}
