/*
 * 冻结组件（R1-c）：SidebarRow / MessageView / Composer / TaskCard / ArtifactCard
 * 视觉契约来自 Grok Bot 0.39.0 实测 token（./tokens.ts，design-ref/NOTES.md）。
 * 私聊与群聊共用 MessageView/Composer；差异只通过 props 表达。
 * 本模块自包含（不回依赖 index.tsx），是客户端的基础层。
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { resolveGlyph } from './avatars'
import { identityMark } from './avatar-mark'
import { TOKENS } from './tokens'

/* ---------------- 头像 ---------------- */

export function AvatarView(props: { seed: string; name?: string; glyph?: string; size: number; fontSize?: number; level?: number }): ReactNode {
  const role = resolveGlyph(props.glyph)
  const label = props.name || (role === 'chief' ? '幕僚长' : 'Bot')
  return <span className="gk-avatar-mark" style={{ width: props.size, height: props.size, display: 'inline-flex', flex: 'none', position: 'relative' }}>
    <img src={`data:image/svg+xml,${encodeURIComponent(identityMark(role, props.name || props.seed))}`} data-avatar-role={role || 'custom'} width={props.size} height={props.size} alt={label} draggable={false} style={{ display: 'block', width: '100%', height: '100%' }} />
    {props.level && props.level >= 4 && props.size >= 30 ? <span aria-label={`等级 ${props.level}`} style={{ position: 'absolute', right: -1, bottom: -1, borderRadius: 5, background: 'var(--gk-bg-side, #f7f7f7)', color: '#947126', fontSize: 10, fontWeight: 700, padding: '0 2px', lineHeight: '13px' }}>★</span> : null}
  </span>
}

type AvatarMember = { seed: string; name?: string; glyph?: string }
export function GroupAvatarView({ members, size, name }: { members: AvatarMember[]; size: number; name?: string }): ReactNode {
  const visible = members.slice(0, members.length > 4 ? 3 : 4)
  return <span role="img" aria-label={`${name || '群聊'}，${members.length} 位成员`} className="gk-group-avatar" style={{ width: size, height: size, flex: 'none', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: members.length === 2 ? '1fr' : '1fr 1fr', gap: 1, padding: 2, boxSizing: 'border-box', borderRadius: size * .26, background: 'var(--gk-bg-card, rgba(120,120,128,.08))', alignItems: 'center', justifyItems: 'center' }}>
    {visible.map((member, i) => <span key={member.seed} aria-hidden="true" style={{ display: 'flex', ...(members.length === 3 && i === 2 ? { gridColumn: '1 / -1' } : {}) }}><AvatarView {...member} size={(size - 5) / 2} /></span>)}
    {members.length > 4 ? <span aria-hidden="true" style={{ fontSize: Math.max(9, size * .25), fontWeight: 650, lineHeight: 1, color: 'var(--gk-text-2, #666)', fontVariantNumeric: 'tabular-nums' }}>+{members.length - 3}</span> : null}
  </span>
}

/* ---------------- 轻量 Markdown ---------------- */

let mdKeySeed = 0
function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/[^\s)]+|\/api\/plugins\/grokbot\/artifacts\/[a-z0-9-]+)\)|https?:\/\/[^\s)]+)/g
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
      const link = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/api\/plugins\/grokbot\/artifacts\/[a-z0-9-]+)\)/.exec(token)
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

export const MarkdownView = memo(function MarkdownView(props: { text: string }): ReactNode {
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
})

export function splitChips(text: string): { body: string; chips: string[] } {
  const match = /\n?\[\[([^\]\n]+)\]\]\s*$/.exec(text)
  if (!match) return { body: text, chips: [] }
  return {
    body: text.slice(0, match.index),
    chips: match[1].split('|').map((entry) => entry.trim()).filter(Boolean).slice(0, 6),
  }
}

/* ---------------- SidebarRow ---------------- */

export interface SidebarRowProps {
  seed: string
  name: string
  glyph?: string
  preview?: string | null
  time?: string | null
  unread?: boolean
  active?: boolean
  working?: boolean
  level?: number
  stack?: { seed: string; name?: string; glyph?: string }[]
  onClick?: () => void
}

export function SidebarRow(props: SidebarRowProps): ReactNode {
  const size = TOKENS.size.avatarRow
  const avatar = props.stack && props.stack.length > 1
    ? <GroupAvatarView members={props.stack} size={size} name={props.name} />
    : <AvatarView seed={props.seed} name={props.name} glyph={props.glyph} size={size} level={props.working ? undefined : props.level} />
  return (
    <button type="button" className={`gkf-row${props.active ? ' active' : ''}`} onClick={props.onClick}>
      {avatar}
      <span className="gkf-row__main">
        <span className="gkf-row__line1">
          <span className="gkf-row__name">{props.name}</span>
          {props.time ? <span className="gkf-row__time">{props.time}</span> : null}
        </span>
        {props.preview ? <span className="gkf-row__preview">{props.preview}</span> : null}
      </span>
      {props.unread ? <span className="gkf-row__unread" /> : null}
    </button>
  )
}

/* ---------------- MessageView ---------------- */

export interface ArtifactInfo {
  id: string
  name: string
  size?: number | null
  mime?: string | null
  sha256?: string | null
  taskId?: string | null
}

export interface MessageViewProps {
  role: 'user' | 'bot' | 'notice' | 'activity' | 'error'
  text: string
  at?: number | null
  senderName?: string
  senderGlyph?: string
  markdown?: boolean
  artifact?: ArtifactInfo | null
  onContinueArtifact?: (artifact: ArtifactInfo) => void
  children?: ReactNode
}

function timeOf(at?: number | null): string {
  if (!at) return ''
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageView(props: MessageViewProps): ReactNode {
  const time = timeOf(props.at)
  // 参照：时间戳一律在消息块上方（用户右对齐、AI 左对齐/随发送者名）
  if (props.role === 'user') {
    return (
      <div className="gkf-msg gkf-msg--user">
        {time ? <div className="gkf-msg__meta gkf-msg__meta--right">{time}</div> : null}
        <div className="gkf-msg__bubble">{props.text}</div>
      </div>
    )
  }
  if (props.role === 'bot') {
    return (
      <div className="gkf-msg gkf-msg--bot">
        {props.senderName
          ? <div className="gkf-msg__sender" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{props.senderGlyph ? <AvatarView seed={props.senderName ?? 'bot'} name={props.senderName} glyph={props.senderGlyph} size={15} /> : null}{props.senderName}{time ? <span style={{ fontWeight: 400, color: TOKENS.color.text3, fontSize: TOKENS.font.time, marginLeft: 8 }}>{time}</span> : null}</div>
          : time ? <div className="gkf-msg__meta gkf-msg__meta--left">{time}</div> : null}
        <div className="gkf-msg__bubble">{props.markdown === false ? props.text : <MarkdownView text={props.text} />}</div>
        {props.artifact
          ? (
            <ArtifactCard
              name={props.artifact.name}
              size={props.artifact.size ?? null}
              mime={props.artifact.mime ?? null}
              actions={[
                ...(props.artifact.taskId && props.onContinueArtifact
                  ? [{ label: '继续修改', primary: true, onClick: () => props.onContinueArtifact!(props.artifact!) }]
                  : []),
                { label: '预览', onClick: () => window.open(`/api/plugins/grokbot/artifacts/${props.artifact!.id}`, '_blank') },
                { label: '保存副本', onClick: () => window.open(`/api/plugins/grokbot/artifacts/${props.artifact!.id}?download=1`, '_blank') },
                { label: '在 Finder 显示工作文件', onClick: () => {
                  void fetch(`/api/plugins/grokbot/artifacts/${props.artifact!.id}?action=reveal`, { method: 'POST' })
                    .then(async (r) => { if (!r.ok) window.alert(`无法显示工作文件：${await r.text().catch(() => r.status)}`) })
                    .catch((e) => window.alert(`无法显示工作文件：${String(e)}`))
                } },
              ]}
            />
          )
          : null}
        {props.children}
      </div>
    )
  }
  const cls = props.role === 'activity' ? 'gkf-msg--activity' : props.role === 'error' ? 'gkf-msg--error' : 'gkf-msg--notice'
  return (
    <div className={`gkf-msg ${cls}`}>
      <div className="gkf-msg__card">{props.text}</div>
    </div>
  )
}

/* ---------------- Composer ---------------- */

export interface ComposerProps {
  draft: string
  onDraft: (value: string) => void
  onSend: () => void
  sending?: boolean
  placeholder?: string
  plusTitle?: string
  onPlus?: () => void
}

export function Composer(props: ComposerProps): ReactNode {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(160, el.scrollHeight)}px`
  }, [props.draft])
  return (
    <div className="gkf-composer">
      <div className="gkf-composer__pill">
        <button type="button" className="gkf-composer__plus" title={props.plusTitle ?? '附件（待实现）'} disabled={!props.onPlus} onClick={props.onPlus}>＋</button>
        <textarea
          ref={ref}
          className="gkf-composer__input"
          rows={1}
          value={props.draft}
          placeholder={props.placeholder ?? '发消息…'}
          onChange={(event) => props.onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (!props.sending) props.onSend()
            }
          }}
        />
        <button type="button" className="gkf-composer__send" disabled={props.sending || !props.draft.trim()} title="发送" onClick={props.onSend}>↑</button>
      </div>
    </div>
  )
}

/* ---------------- TaskCard ---------------- */

export type TaskStatus = 'queued' | 'running' | 'waiting-you' | 'confirm-stop' | 'done' | 'failed' | 'interrupted'

export interface TaskMember {
  name: string
  glyph?: string
  desc: string
  state: 'done' | 'running' | 'failed' | 'idle'
}

export interface TaskAction {
  label: string
  onClick?: () => void
  primary?: boolean
  disabled?: boolean
}

export interface TaskCardProps {
  title: string
  status: TaskStatus
  members?: TaskMember[]
  time?: number | null
  executor?: string
  actions?: TaskAction[]
}

const STATUS_LABEL: Record<TaskStatus, { label: string; cls: string }> = {
  queued: { label: '排队中', cls: 'gkf-task__badge--info' },
  running: { label: '处理中', cls: 'gkf-task__badge--running' },
  'waiting-you': { label: '等待你', cls: 'gkf-task__badge--running' },
  'confirm-stop': { label: '停止确认中', cls: 'gkf-task__badge--running' },
  done: { label: '已完成', cls: 'gkf-task__badge--done' },
  failed: { label: '失败', cls: 'gkf-task__badge--failed' },
  interrupted: { label: '已中断', cls: 'gkf-task__badge--interrupted' },
}

export function TaskCard(props: TaskCardProps): ReactNode {
  const badge = STATUS_LABEL[props.status]
  const dotColor = (state: TaskMember['state']) => state === 'done' ? TOKENS.color.dotDone : state === 'running' ? TOKENS.color.badgeRunning : state === 'failed' ? TOKENS.color.dotFail : TOKENS.color.text3
  return (
    <div className="gkf-task">
      <div className="gkf-task__head">
        <span className="gkf-task__icon" style={{ background: 'linear-gradient(135deg,#38bcf8,#2563eb)' }}>▶</span>
        <span className="gkf-task__title">{props.title}</span>
        {props.time ? <span className="gkf-task__time">{timeOf(props.time)}</span> : null}
      </div>
      {(props.members ?? []).length > 0
        ? (
          <div className="gkf-task__body">
            {(props.members ?? []).map((member) => (
              <div key={member.name} className="gkf-task__member">
                <span className="gkf-task__member-dot" style={{ background: dotColor(member.state) }} />
                <span className="gkf-task__member-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{member.glyph ? <AvatarView seed={member.name ?? 'bot'} name={member.name} glyph={member.glyph} size={15} /> : null}{member.name}</span>
                <span className="gkf-task__member-desc">{member.desc}</span>
              </div>
            ))}
            {props.executor ? <div style={{ fontSize: TOKENS.font.time, color: TOKENS.color.text3 }}>执行机：{props.executor}</div> : null}
          </div>
        )
        : null}
      <div className="gkf-task__foot">
        <span className={`gkf-task__badge ${badge.cls}`}><i />{badge.label}</span>
        <span className="gkf-task__spacer" />
        {(props.actions ?? []).map((action) => (
          <button key={action.label} type="button" className={`gkf-task__btn${action.primary ? ' gkf-task__btn--primary' : ''}`} disabled={action.disabled} onClick={action.onClick}>{action.label}</button>
        ))}
      </div>
    </div>
  )
}

/* ---------------- ArtifactCard ---------------- */

export interface ArtifactCardProps {
  name: string
  size?: number | null
  mime?: string | null
  icon?: string
  actions?: TaskAction[]
}

export function ArtifactCard(props: ArtifactCardProps): ReactNode {
  const kb = typeof props.size === 'number' && props.size > 0 ? `${(props.size / 1024).toFixed(props.size < 10240 ? 1 : 0)} KB` : ''
  return (
    <div className="gkf-artifact">
      <span className="gkf-artifact__icon">{props.icon ?? '📄'}</span>
      <span className="gkf-artifact__main">
        <span className="gkf-artifact__name">{props.name}</span>
        <span className="gkf-artifact__meta">{[kb, props.mime].filter(Boolean).join(' · ') || '成果文件'}</span>
      </span>
      <span className="gkf-artifact__actions">
        {(props.actions ?? []).map((action) => (
          <button key={action.label} type="button" className={`gkf-artifact__btn${action.primary ? ' gkf-artifact__btn--primary' : ''}`} disabled={action.disabled} onClick={action.onClick}>{action.label}</button>
        ))}
      </span>
    </div>
  )
}
