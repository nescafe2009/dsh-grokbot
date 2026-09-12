import {characterActivity} from './character-state'
import {MotionSettings} from './character'
import {CHARACTER_CSS} from './character-css'
import {PermissionRules} from './permission-rules'
import {UX_CSS} from './ux'
import {ArchiveComputer} from './archive-library'
import { ModelLibrary } from './model-library'
import {BotWorkPanel,focusBotWork} from './bot-work'
import {uniqueMessages} from './message-identity'
import {ApprovalView,APPROVAL_CSS} from './approval-view'
import {ProjectBoard,BOARD_CSS} from './project-board'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { GroupAvatarView, AvatarView, MarkdownView, splitChips, SidebarRow, MessageView, Composer, TaskCard } from './components'
import { GKF_CSS } from './tokens'
import { getPendingRetry, setPendingRetry, clearPendingRetry, retryMatches, retryRiskLevel, allocateSeq } from './retry-store'
import { saveDraft, loadDraft } from './draft-store'
import { useChatScroll } from './chat-scroll'

export const API_ROOT = '/api/plugins/grokbot'
const POLL_MS = 2000

interface BotInfo {
  id: string
  name: string
  avatar: string
  title: string
  pinned: boolean
  section: string
  hidden: boolean
  motionPhase?: 'active'|'working'
  status: 'idle' | 'working'
  accessMode?: 'full' | 'review'
  currentWorkTitle?: string | null
  currentConversationId?: string | null
  currentJob: string | null
  currentRunId?: string | null
  currentTaskId?: string | null
  lastActivity: number | null
  lastMessage?: string
  lastAt?: number | null
  lastFrom?: string
  setupStage?: 'await-role' | 'await-name'
  model?: { provider: string; model: string } | null
  dshSessionId?: string | null
  roleTemplate?: string | null
  rating?: BotRating | null
}

interface BotRating {
  growth?: {latestUrl?:string|null;exp:number;reviews:number;verified:number;latest?:{score:number|null}|null}

  level: number
  title: string
  stars?: number
  exp: number
  nextAt?: number | null
  tasksDone: number
  tasksFailed: number
  thumbsUp: number
  thumbsDown: number
}

interface ConversationInfo {
  lifecycle?:{status:string;revision:number}|null
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
  ruleCandidate?:{workspace:string;mode:string;label:string}|null
  stage?: 'chief' | 'user'
  botName?: string
  reviewReason?: string
  details?: string
  id: string
  botId: string
  toolName: string
  reason: string
  createdAt: number
}

interface RoomMessage {
  messageId?: string
  requestId?: string
  ts: number
  role: string
  botId?: string
  fromBotId?: string
  toBotId?: string
  text: string
  activity?: string[]
  artifact?: ArtifactInfo | null
}

interface ArtifactInfo {
  id: string
  name: string
  size?: number | null
  mime?: string | null
  sha256?: string | null
  taskId?: string | null
}

interface ChatMessage {
  id: string
  role: 'user' | 'bot' | 'error' | 'activity'
  text: string
  at: number
  artifact?: ArtifactInfo | null
  requestId?: string
}

interface GrokbotState {
  stale?:boolean
  accessControl?: {supported:boolean}
  lastTarget?: { kind: string; id: string } | null
  bots: BotInfo[]
  conversations: ConversationInfo[]
  routines: RoutineInfo[]
  approvals: ApprovalInfo[]
  running: { jobId: string; botId: string; startedAt: number }[]
  queued: { jobId: string; botId: string; conversationId: string | null; text: string }[]
  queueDepth: number
  recentJobs: { jobId: string; botId: string; status: string; endedAt: number | null }[]
}

interface CatalogProvider {
  id: string
  name: string
  models: { id: string; name: string }[]
}

const GROKBOT_CSS = BOARD_CSS + APPROVAL_CSS + `
:root {
  --gk-bg-side: #f7f7f7;
  --gk-bg: #fcfcfc;
  --gk-bg-soft: #f2f2f7;
  --gk-text: #1d1d1f;
  --gk-text-2: rgba(29,29,31,.55);
  --gk-text-3: rgba(29,29,31,.35);
  --gk-line: rgba(29,29,31,.08);
  --gk-accent: #2563eb;
  --gk-accent-2: #3b82f6;
  --gk-accent-soft: rgba(37,99,235,.10);
  --gk-green: #22c55e;
  --gk-amber: #f59e0b;
  --gk-red: #ef4444;
  --gk-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", "Segoe UI", sans-serif;
  --gk-shadow-sm: 0 1px 3px rgba(29,29,31,.06), 0 1px 2px rgba(29,29,31,.04);
  --gk-shadow-md: 0 6px 24px rgba(29,29,31,.10);
}
.grokbot-sidebar, .grokbot-chat, .grokbot-wizard { font-family: var(--gk-font); color: var(--gk-text); }
.grokbot-sidebar { display:flex; flex-direction:column; min-height:0; flex:1; background:var(--gk-bg-side); }
.grokbot-sidebar__top { display:flex; align-items:center; justify-content:flex-end; gap:2px; padding:16px 12px 6px; }
.grokbot-iconbtn { border:none; background:none; cursor:pointer; color:var(--gk-text-2); font-size:var(--gk-font-body); width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border-radius:9px; transition:all .16s cubic-bezier(.4,0,.2,1); }
.grokbot-iconbtn:hover { color:var(--gk-text); background:rgba(29,29,31,.07); }
.grokbot-sidebar__search { margin:4px 12px 10px; }
.grokbot-sidebar__search input { width:100%; box-sizing:border-box; border:none; border-radius:9px; background:rgba(29,29,31,.06); padding:7px 12px; font:inherit; font-size:var(--gk-font-label); color:var(--gk-text); outline:none; transition:all .16s; }
.grokbot-sidebar__search input:focus { background:#fff; box-shadow:0 0 0 3px var(--gk-accent-soft); }
.grokbot-sidebar__search input::placeholder { color:var(--gk-text-3); }
.grokbot-sidebar__list { flex:1; overflow-y:auto; padding:0 8px 8px; scrollbar-width:thin; }
.grokbot-sidebar__list::-webkit-scrollbar { width:4px; }
.grokbot-sidebar__list::-webkit-scrollbar-thumb { background:rgba(29,29,31,.15); border-radius:4px; }
.grokbot-sidebar__section { font-size:var(--gk-font-meta); font-weight:600; color:var(--gk-text-3); margin:12px 8px 4px; letter-spacing:.06em; text-transform:uppercase; }
.grokbot-chatrow { display:flex; align-items:center; gap:10px; width:100%; padding:8px 10px; border:none; border-radius:11px; background:transparent; cursor:pointer; text-align:left; font:inherit; color:inherit; position:relative; transition:background .14s; }
.grokbot-chatrow:hover { background:rgba(29,29,31,.05); }
.grokbot-chatrow.active { background:var(--gk-accent-soft); }
.grokbot-chatrow.active::before { content:""; position:absolute; left:-2px; top:22%; bottom:22%; width:3px; border-radius:3px; background:linear-gradient(180deg,var(--gk-accent-2),var(--gk-accent)); }
.grokbot-avatar { position:relative; flex:none; }
.grokbot-avatar__circle { width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:var(--gk-font-body); color:#fff; box-shadow:inset 0 -1px 2px rgba(0,0,0,.12), var(--gk-shadow-sm); }
.grokbot-avatar__dot { position:absolute; right:-1px; bottom:-1px; width:11px; height:11px; border-radius:50%; background:var(--gk-green); border:2.5px solid var(--gk-bg-side); box-sizing:content-box; }
.grokbot-avatar__dot.working { background:var(--gk-amber); animation:grokbot-pulse 1.3s ease-in-out infinite; }
.grokbot-chatrow__main { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.grokbot-chatrow__line1 { display:flex; align-items:baseline; gap:6px; }
.grokbot-chatrow__name { font-size:var(--gk-font-label); font-weight:600; letter-spacing:-.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-chatrow__time { margin-left:auto; font-size:var(--gk-font-meta); color:var(--gk-text-3); flex:none; font-variant-numeric:tabular-nums; }
.grokbot-chatrow__preview { font-size:var(--gk-font-meta); color:var(--gk-text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-sidebar__computer { display:flex; align-items:center; justify-content:space-between; width:100%; padding:8px 10px; border:none; border-radius:9px; background:transparent; cursor:pointer; font:inherit; font-size:var(--gk-font-label); color:var(--gk-text); transition:background .12s; }
.grokbot-sidebar__computer:hover { background:rgba(29,29,31,.06); }
.grokbot-sidebar__computer-status { width:8px; height:8px; border-radius:50%; background:var(--gk-green); }
.grokbot-sidebar__foot { border-top:1px solid var(--gk-line); padding:10px 14px; display:flex; align-items:center; gap:8px; }
.gk-ico { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; font-size:var(--gk-font-body); line-height:1; flex:none; }
.gk-lbl { flex:1; text-align:left; }
.gk-foot-ico { width:34px; height:34px; padding:0; display:inline-flex; align-items:center; justify-content:center; }
/* 窄窗 rail 模式：宿主折叠侧栏列（~79px）时只保留头像/图标列 */
.grokbot-sidebar.gk-rail { overflow:hidden; }
.gk-rail .grokbot-sidebar__search, .gk-rail .grokbot-sidebar__section, .gk-rail .gkf-row__main,
.gk-rail .grokbot-newmenu, .gk-rail .grokbot-form, .gk-rail .grokbot-sidebar__user, .gk-rail .grokbot-avatar__dot { display:none !important; }
.gk-rail .grokbot-sidebar__top { justify-content:center; padding:14px 4px 8px; }
.gk-rail .grokbot-sidebar__list { padding:0 4px 8px; }
.gk-rail .gkf-row { justify-content:center; padding:10px 2px; min-height:52px; }
.gk-rail .grokbot-sidebar__foot { flex-direction:column; padding:8px 0; gap:10px; }
.gk-rail .grokbot-sidebar__computer { width:auto; padding:4px; justify-content:center; }
.gk-rail .gk-lbl, .gk-rail .grokbot-sidebar__computer-status { display:none !important; }
.gk-rail .grokbot-routinemenu { display:none !important; }
.gk-rail .grokbot-sidebar__computer { padding:6px; font-size:0; }
.gk-rail .grokbot-sidebar__computer-status { display:none; }
.grokbot-sidebar__user { display:flex; align-items:center; gap:8px; flex:1; min-width:0; font-size:var(--gk-font-label); font-weight:600; color:var(--gk-text-2); }
.grokbot-sidebar__user .uavatar { width:26px; height:26px; border-radius:50%; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; display:flex; align-items:center; justify-content:center; font-size:var(--gk-font-meta); font-weight:700; }
@keyframes grokbot-pulse { 0%,100% { opacity:1; transform:scale(1) } 50% { opacity:.4; transform:scale(.85) } }
.grokbot-newmenu { display:flex; flex-direction:column; gap:2px; margin:0 10px 10px; padding:6px; border:1px solid var(--gk-line); border-radius:13px; background:#fff; box-shadow:var(--gk-shadow-md); }
.grokbot-newmenu__item { display:flex; align-items:center; gap:9px; width:100%; padding:8px 10px; border:none; border-radius:9px; background:transparent; cursor:pointer; font:inherit; font-size:var(--gk-font-label); color:var(--gk-text); text-align:left; transition:background .12s; }
.grokbot-newmenu__item:hover { background:var(--gk-bg-soft); }
.grokbot-newmenu__item:disabled { opacity:.5; }
.grokbot-newmenu__icon { width:24px; height:24px; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; font-size:var(--gk-font-label); flex:none; background:var(--gk-bg-soft); }
.grokbot-newmenu__divider { height:1px; background:var(--gk-line); margin:4px 6px; }
.grokbot-form { display:flex; flex-direction:column; gap:8px; padding:12px; margin:0 10px 8px; border:1px solid var(--gk-line); border-radius:13px; background:#fff; box-shadow:var(--gk-shadow-sm); }
.grokbot-form__row { display:flex; gap:6px; }
.grokbot-form input, .grokbot-form textarea, .grokbot-form select { flex:1; min-width:0; border:1px solid var(--gk-line); border-radius:9px; padding:7px 10px; font:inherit; font-size:var(--gk-font-label); background:var(--gk-bg); color:var(--gk-text); transition:border-color .14s, box-shadow .14s; }
.grokbot-form input:focus, .grokbot-form textarea:focus, .grokbot-form select:focus { outline:none; border-color:var(--gk-accent-2); box-shadow:0 0 0 3px var(--gk-accent-soft); }
.grokbot-form textarea { resize:vertical; min-height:52px; }
.grokbot-form__actions { display:flex; gap:8px; justify-content:flex-end; }
.grokbot-form__actions button { border:none; border-radius:9px; padding:6px 16px; font-size:var(--gk-font-label); cursor:pointer; font-weight:600; transition:all .14s; }
.grokbot-form__submit { background:linear-gradient(135deg,var(--gk-accent-2),var(--gk-accent)); color:#fff; box-shadow:0 2px 8px rgba(37,99,235,.28); }
.grokbot-form__submit:hover { filter:brightness(1.06); box-shadow:0 4px 12px rgba(37,99,235,.36); }
.grokbot-form__submit:disabled { opacity:.5; box-shadow:none; }
.grokbot-form__cancel { background:var(--gk-bg-soft); color:var(--gk-text); }
.grokbot-form__cancel:hover { background:rgba(29,29,31,.10); }
.grokbot-chat { width:100%; height:100%; min-height:0; overflow:hidden; display:flex; flex-direction:column; background:var(--gk-bg); }
.grokbot-chat__head { display:flex; align-items:center; gap:11px; padding:13px 20px; border-bottom:1px solid var(--gk-line); background:rgba(255,255,255,.85); backdrop-filter:blur(12px); }
.grokbot-chat__avatar { width:38px; height:38px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:var(--gk-font-title); color:#fff; box-shadow:inset 0 -1px 2px rgba(0,0,0,.12), var(--gk-shadow-sm); }
.grokbot-chat__title { flex:1; display:flex; flex-direction:column; min-width:0; cursor:pointer; }
.grokbot-chat__name { font-weight:650; font-size:var(--gk-font-body); letter-spacing:-.015em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-chat__meta { font-size:var(--gk-font-meta); color:var(--gk-text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:1px; }
.grokbot-chat__stop { border:1px solid rgba(239,68,68,.35); background:rgba(239,68,68,.08); color:var(--gk-red); border-radius:9px; padding:5px 14px; font-size:var(--gk-font-meta); cursor:pointer; font-weight:600; transition:all .14s; }
.grokbot-chat__stop:hover { background:rgba(239,68,68,.16); }
.grokbot-chat__close { border:none; background:none; cursor:pointer; color:var(--gk-text-2); font-size:var(--gk-font-body); width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border-radius:9px; transition:all .14s; }
.grokbot-chat__close:hover { color:var(--gk-text); background:rgba(29,29,31,.07); }
.grokbot-body { position:relative; flex:1; display:flex; min-height:0; }
.grokbot-log { flex:1; min-width:0; min-height:0; overflow-y:auto; padding:26px 20px; display:flex; flex-direction:column; gap:13px; scrollbar-width:thin; }
.grokbot-jump-latest { position:absolute; bottom:14px; left:50%; transform:translateX(-50%); z-index:3; border:1px solid var(--gk-line); border-radius:99px; padding:10px 16px; background:var(--gk-bg); color:var(--gk-text); box-shadow:0 3px 14px #0002; font:inherit; font-size:var(--gk-font-meta); cursor:pointer; }
.grokbot-log > * { flex-shrink:0; }
.grokbot-log::-webkit-scrollbar { width:5px; }
.grokbot-log::-webkit-scrollbar-thumb { background:rgba(29,29,31,.15); border-radius:5px; }
.grokbot-msg { max-width:72%; }
.grokbot-msg.approval { align-self:flex-start; border:1px solid rgba(245,158,11,.4); background:linear-gradient(180deg,#fffbeb,#fff8e6); border-radius:14px; padding:11px 15px; box-shadow:var(--gk-shadow-sm); }
.grokbot-approval__title { font-size:var(--gk-font-label); font-weight:650; margin-bottom:4px; }
.grokbot-approval__reason { font-size:var(--gk-font-label); color:var(--gk-text-2); margin-bottom:10px; white-space:pre-wrap; }
.grokbot-approval__actions { display:flex; gap:8px; }
.grokbot-approval__actions button { border:none; border-radius:9px; padding:6px 18px; font-size:var(--gk-font-label); font-weight:600; cursor:pointer; transition:all .14s; }
.grokbot-approval__ok { background:linear-gradient(135deg,#34d399,#22c55e); color:#fff; box-shadow:0 2px 8px rgba(34,197,94,.3); }
.grokbot-approval__ok:hover { filter:brightness(1.05); }
.grokbot-approval__no { background:var(--gk-bg-soft); color:var(--gk-text); }
.grokbot-empty { margin:auto; text-align:center; color:var(--gk-text-3); font-size:var(--gk-font-label); line-height:1.7; }
.grokbot-details { width:272px; flex:none; border-left:1px solid var(--gk-line); overflow-y:auto; padding:16px 16px 24px; display:flex; flex-direction:column; gap:18px; background:#fafafc; }
.grokbot-rating { border:1px solid var(--gk-line); border-radius:12px; padding:11px 13px; background:#fff; }
.grokbot-rating__head { display:flex; align-items:center; gap:8px; }
.grokbot-rating__level { background:linear-gradient(135deg,var(--gk-accent-2),var(--gk-accent)); color:#fff; font-size:var(--gk-font-meta); font-weight:700; border-radius:7px; padding:2px 8px; }
.grokbot-rating__title { font-size:var(--gk-font-label); font-weight:650; }
.grokbot-rating__stars { margin-left:auto; color:#f5a623; font-size:var(--gk-font-meta); letter-spacing:1px; }
.grokbot-rating__bar { height:6px; border-radius:3px; background:var(--gk-bg-soft); margin:9px 0 6px; overflow:hidden; }
.grokbot-rating__fill { height:100%; border-radius:3px; background:linear-gradient(90deg,var(--gk-accent-2),var(--gk-accent)); transition:width .3s; }
.grokbot-rating__nums { font-size:var(--gk-font-meta); color:var(--gk-text-3); font-variant-numeric:tabular-nums; }
.grokbot-fb { margin-left:8px; white-space:nowrap; }
.grokbot-fb button { border:none; background:none; cursor:pointer; font-size:var(--gk-font-meta); opacity:.4; padding:0 2px; transition:opacity .12s, transform .12s; }
.grokbot-fb button:hover { opacity:1; transform:scale(1.2); }
.grokbot-details__title { font-size:var(--gk-font-meta); font-weight:700; color:var(--gk-text-3); letter-spacing:.07em; text-transform:uppercase; }
.grokbot-member { display:flex; align-items:center; gap:10px; padding:7px 6px; font-size:var(--gk-font-label); font-weight:500; border-radius:9px; }
.grokbot-member:hover { background:rgba(29,29,31,.04); }
.grokbot-member .mavatar { width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:var(--gk-font-label); color:#fff; box-shadow:var(--gk-shadow-sm); }
.grokbot-details__hint { font-size:var(--gk-font-meta); color:var(--gk-text-3); padding:4px 6px 0; line-height:1.5; }
.grokbot-routine { border:1px solid var(--gk-line); border-radius:11px; padding:9px 11px; font-size:var(--gk-font-meta); background:#fff; }
.grokbot-routine__prompt { color:var(--gk-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.grokbot-routine__sched { font-size:var(--gk-font-meta); color:var(--gk-text-3); margin-top:3px; }
.grokbot-details__new { border:1px dashed rgba(37,99,235,.4); border-radius:11px; background:rgba(37,99,235,.04); color:var(--gk-accent); padding:8px; font-size:var(--gk-font-label); font-weight:600; cursor:pointer; width:100%; transition:all .14s; }
.grokbot-details__new:hover { background:var(--gk-accent-soft); border-color:var(--gk-accent-2); }
.gk-modelbar { display:flex; align-items:center; gap:8px; padding:5px 20px; border-bottom:1px solid var(--gk-line); background:#fafafc; font-family:ui-monospace,"SF Mono",Menlo,monospace; }
.gk-modelbar__label { font-size:var(--gk-font-meta); font-weight:700; color:var(--gk-text-3); letter-spacing:.1em; }
.gk-modelbar__select { border:1px solid var(--gk-line); border-radius:6px; padding:2px 8px; font:inherit; font-size:var(--gk-font-meta); background:#fff; color:var(--gk-text); outline:none; cursor:pointer; max-width:280px; }
.gk-modelbar__select:focus { border-color:var(--gk-accent-2); }
.gk-modelbar__custom { font-size:var(--gk-font-meta); color:var(--gk-accent); font-weight:700; }
.gk-modelbar__default { font-size:var(--gk-font-meta); color:var(--gk-text-3); }
.grokbot-md__p { white-space:pre-wrap; }
.grokbot-md__h1, .grokbot-md__h2, .grokbot-md__h3, .grokbot-md__h4 { font-weight:700; margin:8px 0 3px; letter-spacing:-.01em; }
.grokbot-md__h1 { font-size:var(--gk-font-title); } .grokbot-md__h2 { font-size:var(--gk-font-body); } .grokbot-md__h3 { font-size:var(--gk-font-body); } .grokbot-md__h4 { font-size:var(--gk-font-label); }
.grokbot-md__ul { margin:3px 0; padding-left:19px; }
.grokbot-md__ul li { margin:2px 0; }
.grokbot-md__quote { border-left:3px solid var(--gk-line); margin:5px 0; padding:2px 11px; color:var(--gk-text-2); }
.grokbot-md__hr { border:none; border-top:1px solid var(--gk-line); margin:9px 0; }
.grokbot-md__spacer { height:6px; }
.grokbot-md__icode { background:rgba(29,29,31,.07); border-radius:6px; padding:1.5px 6px; font-size:var(--gk-font-label); font-family:ui-monospace,"SF Mono",Menlo,monospace; }
.grokbot-md__link { color:var(--gk-accent); text-decoration:none; font-weight:500; }
.grokbot-md__link:hover { text-decoration:underline; }
.grokbot-code { align-self:stretch; max-width:100%; border:1px solid var(--gk-line); border-radius:13px; overflow:hidden; margin:5px 0; background:#fafafc; box-shadow:var(--gk-shadow-sm); }
.grokbot-code__bar { display:flex; align-items:center; justify-content:space-between; padding:5px 12px; border-bottom:1px solid var(--gk-line); font-size:var(--gk-font-meta); }
.grokbot-code__lang { color:var(--gk-text-3); text-transform:uppercase; letter-spacing:.07em; font-weight:700; font-family:ui-monospace,Menlo,monospace; }
.grokbot-code__actions { display:flex; gap:8px; }
.grokbot-code__actions button { border:none; background:none; cursor:pointer; font-size:var(--gk-font-meta); color:var(--gk-accent); font-weight:600; padding:2px 4px; }
.grokbot-code__actions button:hover { text-decoration:underline; }
.grokbot-code__pre { margin:0; padding:11px 14px; overflow-x:auto; font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:var(--gk-font-label); line-height:1.55; white-space:pre; color:var(--gk-text); }
.grokbot-code__pre.collapsed { display:none; }
.grokbot-code__peek { border:none; background:none; cursor:pointer; text-align:left; padding:9px 14px; font-family:ui-monospace,Menlo,monospace; font-size:var(--gk-font-meta); color:var(--gk-text-3); width:100%; }
.grokbot-chips { display:flex; flex-wrap:wrap; gap:7px; margin-top:9px; }
.grokbot-chips__item { border:1px solid rgba(37,99,235,.35); background:var(--gk-accent-soft); color:var(--gk-accent); border-radius:16px; padding:5px 16px; font-size:var(--gk-font-label); cursor:pointer; font-weight:600; transition:all .14s; }
.grokbot-chips__item:hover { background:rgba(37,99,235,.18); transform:translateY(-1px); }
.grokbot-chips__item:disabled { opacity:.45; cursor:default; transform:none; }
.grokbot-blank { flex:1; }
.grokbot-home { flex:1; overflow-y:auto; display:flex; flex-direction:column; align-items:center; gap:34px; padding:72px 32px; background:radial-gradient(1200px 500px at 50% 20%, #f8f9fc 0%, var(--gk-bg) 60%); }
.grokbot-home__hero { text-align:center; display:flex; flex-direction:column; align-items:center; gap:10px; }
.grokbot-home__title { font-size:var(--gk-font-display); font-weight:750; letter-spacing:-.02em; }
.grokbot-home__sub { font-size:var(--gk-font-label); color:var(--gk-text-2); }
.grokbot-home__new { margin-top:10px; border:none; border-radius:99px; padding:11px 26px; font:inherit; font-size:var(--gk-font-label); font-weight:650; cursor:pointer; background:#111; color:#fff; transition:transform .14s, filter .14s; }
.grokbot-home__new:hover { transform:translateY(-1px); filter:brightness(1.15); }
.grokbot-home__grid { display:flex; flex-wrap:wrap; gap:14px; justify-content:center; max-width:720px; }
.grokbot-home__card { width:158px; display:flex; flex-direction:column; align-items:center; gap:6px; padding:20px 12px 14px; border:1px solid var(--gk-line); border-radius:16px; background:#fff; cursor:pointer; font:inherit; color:inherit; transition:all .16s cubic-bezier(.4,0,.2,1); box-shadow:var(--gk-shadow-sm); }
.grokbot-home__card:hover { border-color:rgba(29,29,31,.22); transform:translateY(-2px); box-shadow:0 8px 22px rgba(29,29,31,.10); }
.grokbot-home__name { font-size:var(--gk-font-label); font-weight:650; }
.grokbot-home__desc { font-size:var(--gk-font-meta); color:var(--gk-text-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:130px; }
.grokbot-creating { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; font-size:var(--gk-font-label); color:var(--gk-text-2); font-weight:500; }
.grokbot-creating__spinner { width:28px; height:28px; border-radius:50%; border:3px solid var(--gk-accent-soft); border-top-color:var(--gk-accent); animation:grokbot-spin .75s linear infinite; }
@keyframes grokbot-spin { to { transform:rotate(360deg) } }
.grokbot-wizard { flex:1; overflow-y:auto; display:flex; flex-direction:column; align-items:center; gap:22px; padding:52px 32px; font-family:var(--gk-font); color:var(--gk-text); background:radial-gradient(900px 380px at 50% 12%, #f6f8ff 0%, #fff 55%); }
.grokbot-wizard__steps { display:flex; gap:16px; font-size:var(--gk-font-meta); color:var(--gk-text-3); font-weight:600; letter-spacing:.02em; }
.grokbot-wizard__steps .on { color:var(--gk-accent); font-weight:700; }
.grokbot-wizard__steps .ok { color:var(--gk-text-2); }
.grokbot-wizard__steps .ok::after { content:" ✓"; color:var(--gk-green); font-weight:700; }
.grokbot-wizard__title { font-size:var(--gk-font-title); font-weight:750; letter-spacing:-.02em; }
.grokbot-wizard__roles { display:flex; flex-wrap:wrap; gap:13px; justify-content:center; max-width:660px; }
.grokbot-role { width:152px; display:flex; flex-direction:column; align-items:center; gap:7px; padding:20px 10px 15px; border:1px solid var(--gk-line); border-radius:16px; background:#fff; cursor:pointer; font:inherit; color:inherit; transition:all .18s cubic-bezier(.4,0,.2,1); box-shadow:var(--gk-shadow-sm); }
.grokbot-role:hover { border-color:var(--gk-accent-2); transform:translateY(-3px); box-shadow:0 10px 28px rgba(37,99,235,.16); }
.grokbot-role:disabled { opacity:.5; cursor:default; transform:none; }
.grokbot-role__avatar { width:48px; height:48px; border-radius:16px; display:flex; align-items:center; justify-content:center; box-shadow:var(--gk-shadow-sm); }
.grokbot-role__avatar svg { width:58%; height:58%; }
.grokbot-role__name { font-size:var(--gk-font-body); font-weight:700; letter-spacing:-.01em; }
.grokbot-role__desc { font-size:var(--gk-font-meta); color:var(--gk-text-3); }
.grokbot-wizard__names { display:flex; gap:9px; flex-wrap:wrap; justify-content:center; }
.grokbot-wizard__custom { display:flex; gap:8px; width:min(380px,90%); }
.grokbot-wizard__custom input { flex:1; min-width:0; border:1px solid var(--gk-line); border-radius:11px; padding:10px 14px; font:inherit; font-size:var(--gk-font-label); background:#fff; color:var(--gk-text); outline:none; transition:all .16s; }
.grokbot-wizard__custom input:focus { border-color:var(--gk-accent-2); box-shadow:0 0 0 4px var(--gk-accent-soft); }
.grokbot-wizard__skip { border:none; background:none; color:var(--gk-text-3); font-size:var(--gk-font-label); cursor:pointer; padding:4px 10px; transition:color .14s; }
.grokbot-wizard__skip:hover { color:var(--gk-accent); }
.grokbot-wizard__hint { font-size:var(--gk-font-label); color:var(--gk-text-3); }
`





let openTarget: { kind: 'conversation' | 'computer' | 'routines' | 'settings' | 'permissions'; id: string } | null = null
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
  // 单聊：导航到 DSH 原生 session（ZCode 体验）；群聊不导航（保持 Grok 覆盖层）
  const st = lastKnownState
  if (st) {
    const conv = st.conversations?.find((c) => c.id === conversationId)
    const isGroup = conv && conv.memberBotIds.length > 1
    if (!isGroup) {
      const botId = conv ? conv.memberBotIds[0] : conversationId
      const bot = st.bots?.find((b) => b.id === botId)
      if (bot?.dshSessionId && sessionsService?.open) {
        try { sessionsService.open(bot.dshSessionId) } catch { /* session 可能未就绪 */ }
      }
    }
  }
}

function openComputer(): void {
  openTarget = { kind: 'computer', id: 'computer' }
  notify()
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
  if (typeof document !== 'undefined') {
    if (nativeSidebarVisible) document.body.classList.remove('grokbot-takeover')
    else document.body.classList.add('grokbot-takeover')
  }
  notify()
}

function useOpenTarget(): { kind: 'conversation' | 'computer' | 'routines' | 'settings' | 'permissions'; id: string } | null {
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
const pendingMessages = new Map<string, Map<string, ChatMessage>>()
const historyListeners = new Map<string, Set<() => void>>()
function notifyHistory(id: string): void { for (const fn of historyListeners.get(id) ?? []) fn() }
const loadedHistoryFor = new Set<string>()
// 每会话历史拉取代次：卸载视图的旧实例/旧一轮响应不得覆盖较新历史（latest-wins）
const historyFetchGen = new Map<string, number>()

function historyOf(botId: string): ChatMessage[] {
  let list = histories.get(botId)
  if (!list) {
    list = []
    histories.set(botId, list)
  }
  return list
}

const MAX_HISTORY = 200

function appendLocal(botId: string, message: ChatMessage): void {
  histories.set(botId, [...historyOf(botId).filter(entry => entry.id !== message.id), message].slice(-MAX_HISTORY))
  notifyHistory(botId)
}

let refreshState: (() => void) | null = null
const feedbacked = new Set<string>()

async function sendFeedback(botId: string, messageId: string, good: boolean): Promise<void> {
  if (feedbacked.has(messageId)) return
  feedbacked.add(messageId)
  try {
    await api(`/bots/${encodeURIComponent(botId)}/feedback`, { method: 'POST', body: JSON.stringify(good ? { good: true } : { bad: true }) })
    refreshState?.()
  } catch { feedbacked.delete(messageId) }
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

let lastKnownState: GrokbotState | null = null

function useGrokbotState(): GrokbotState | null {
  const [state, setState] = useState<GrokbotState | null>(null)
  useEffect(() => {
    let alive = true, inFlight=false
    const tick = (): void => {
      if(inFlight)return
      inFlight=true
      api('/state').then((next) => {
        if (alive) {
          const s = next as GrokbotState
          setState(s)
          lastKnownState = s
        }
      }).catch(() => {if(alive){setState(previous=>previous?{...previous,stale:true}:null);if(lastKnownState)lastKnownState={...lastKnownState,stale:true}}}).finally(()=>{inFlight=false})
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

export function ModelSettingsView({accessSupported=false}:{accessSupported?:boolean}={}): ReactNode {
  const [providers, setProviders] = useState<CatalogProvider[]>([])
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [catalog, crew] = await Promise.all([api('/model-catalog'), api('/crew')])
      setProviders(catalog.catalog ?? [])
      setProvider(crew.crew?.defaultModel?.provider ?? '')
      setModel(crew.crew?.defaultModel?.model ?? '')
    } catch (e) { setError(String((e as Error).message)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const save = async () => {
    setBusy(true); setSaved(false); setError('')
    try {
      await api('/crew', { method:'PATCH', body:JSON.stringify({defaultModel:provider ? {provider,model} : null}) })
      setSaved(true)
    } catch (e) { setError(String((e as Error).message)) }
    finally { setBusy(false) }
  }
  const valid = !provider || !!providers.find(p => p.id === provider)?.models.some(m => m.id === model)
  return <section style={{padding:28,overflowY:'auto',height:'100%',boxSizing:'border-box'}}>
    <h2 style={{marginTop:0}}>团队模型</h2>
    <p>管理常用模型，为团队和成员选择合适的配置。</p>
    <ModelLibrary api={api} onDefaultChange={value=>{setProvider(value?.provider||'');setModel(value?.model||'');setSaved(false)}} defaultEditor={loading ? <p>加载中…</p> : <div className="grokbot-form" style={{maxWidth:560}}>
      <label>服务商<select aria-label="默认模型服务商" value={provider} onChange={e=>{setProvider(e.target.value);setModel('');setSaved(false)}}>
        <option value="">跟随 DSH 全局默认</option>
        {providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <label>模型<select aria-label="团队默认模型选择" value={model} disabled={!provider} onChange={e=>{setModel(e.target.value);setSaved(false)}}>
        <option value="">选择模型</option>
        {(providers.find(p=>p.id===provider)?.models ?? []).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
      </select></label>
      {!valid ? <p role="alert">请选择当前可用的模型。</p> : null}
      <button type="button" className="grokbot-form__submit" disabled={busy || !valid || !!error} onClick={()=>void save()}>{busy?'保存中…':'保存默认模型'}</button>
      {saved ? <p role="status">默认模型已保存，下次对话或任务生效。</p> : null}
    </div>} />
    {error ? <p role="alert">{error} <button onClick={()=>void load()}>重新加载</button></p> : null}
    <MotionSettings/>
    <button className="grokbot-home__textlink" onClick={()=>{openTarget={kind:'permissions',id:'permissions'};notify()}}>授权规则 →</button>
    {accessSupported?<AccessSettings/>:null}
  </section>
}

export function BotForm(props: {
  initial?: BotInfo | null
  onCancel: () => void
  onSaved: (bot: BotInfo) => void
}): ReactNode {
  const { initial } = props
  const [avatar, setAvatar] = useState(initial?.avatar ?? '🤖')
  const [name, setName] = useState(initial?.name ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [persona, setPersona] = useState('')
  const [profileLoaded,setProfileLoaded]=useState(!initial)
  const [roleTemplate,setRoleTemplate]=useState(initial?.roleTemplate||'')
  const [roleOptions,setRoleOptions]=useState<{id:string;title:string}[]>([])
  useEffect(()=>{
    let alive=true
    void api('/bot-templates').then(r=>{if(alive)setRoleOptions(Array.isArray(r)?r:r.templates||[])}).catch(()=>{})
    if(initial)void api(`/bots/${encodeURIComponent(initial.id)}`).then(r=>{if(alive){setPersona(r.bot.persona||'');setProfileLoaded(true)}}).catch(()=>{if(alive)setError('资料读取失败，请关闭后重试；未保存任何修改')})
    return()=>{alive=false}
  },[initial?.id])
  const [advanced, setAdvanced] = useState(false)
  const [providers, setProviders] = useState<CatalogProvider[]>([])
  const [providerId, setProviderId] = useState(initial?.model?.provider ?? '')
  const [modelId, setModelId] = useState(initial?.model?.model ?? '')
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
      if(profileLoaded)payload.persona=persona.trim()
      payload.roleTemplate=roleTemplate||null
      if (providerId && !modelId) { setError('请选择模型，或选择跟随团队默认'); setBusy(false); return }
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
  }, [avatar, name, title, persona, providerId, modelId, busy, initial, props,profileLoaded,roleTemplate])

  return (
    <div className="grokbot-form gk-profile-form" role="region" aria-label="成员资料">
      <header><strong>{initial ? '编辑成员资料' : '创建成员'}</strong><p>名称和职位决定身份，补充职责用于约定工作方式。</p></header>
      <label>头像与名称</label>
      <div className="grokbot-form__row">
        <input style={{ maxWidth: 52, textAlign: 'center' }} value={avatar} onChange={(e) => setAvatar(e.target.value)} aria-label="头像" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称（必填）" aria-label="名称" />
      </div>
      <label>职位</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="头衔，如：检索与情报专家" aria-label="头衔" />
      <label>专业角色模板</label>
      <select aria-label="专业角色模板" value={roleTemplate} disabled={initial?.id==='chief'} onChange={e=>setRoleTemplate(e.target.value)}><option value="">按职位识别</option>{roleOptions.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select>
      <label>补充职责</label>
      <textarea value={persona} onChange={(e) => setPersona(e.target.value)} placeholder={initial ? '补充预置职责与工作偏好；清空后恢复预置职责' : '职责与持久规则：它负责什么、怎么做事、安全边界'} aria-label="职责" />
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
      {error ? <span style={{ color: '#cf1322', fontSize: 12 }}>{error}</span> : null}
      <div className="grokbot-form__actions">
        <button type="button" className="grokbot-form__cancel" onClick={props.onCancel}>取消</button>
        <button type="button" className="grokbot-form__submit" disabled={busy||!profileLoaded} onClick={() => void submit()}>{busy?'正在保存…':initial ? '保存' : '创建'}</button>
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
        <label key={bot.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto', flex: 'none' }} checked={selected.includes(bot.id)} onChange={() => toggle(bot.id)} />
          <AvatarView seed={bot.id} name={bot.name} glyph={bot.roleTemplate || bot.avatar} size={17} />
          <span>{bot.name}</span>
        </label>
      ))}
      {error ? <span style={{ color: '#cf1322', fontSize: 12 }}>{error}</span> : null}
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
      {error ? <span style={{ color: '#cf1322', fontSize: 12 }}>{error}</span> : null}
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
  const [creatingBot, setCreatingBot] = useState(false)
  const [filter, setFilter] = useState('')
  const [showArchived,setShowArchived]=useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const hiddenRef = useRef<HTMLElement[]>([])

  const createFromTemplate = useCallback((): void => {
    if (creatingBot) return
    setMenuOpen(false)
    // 进入"召唤中"过渡视图：保持主区接管，既不闪旧会话也不露 DSH 默认页
    openTarget = null
    setCreatingUi(true)
    setCreatingBot(true)
    void api('/bots', { method: 'POST', body: JSON.stringify({}) })
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
  // 窄窗 rail 模式：宿主把侧栏列折叠成 ~79px 图标栏时，我们也只显示头像列（明确折叠，不压成竖排残片）
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const apply = (): void => {
      root.classList.toggle('gk-rail', root.getBoundingClientRect().width < 170)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(root)
    return () => ro.disconnect()
  }, [])
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

  // 统一实体：一个会话一行（dm=成员 bot 档案；群=成员名列表）
  const conversations = (state?.conversations ?? [])
    .filter(c=>showArchived?c.lifecycle?.status==='archived':c.lifecycle?.status!=='archived')
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
      if (bot?.status === 'working') return `工作中 · ${bot.currentWorkTitle || '点击查看实际进展'}`
      if (conversation.lastMessage) return `${conversation.lastFrom === 'user' ? '我: ' : ''}${conversation.lastMessage}`
      return bot?.title || '待命'
    }
    if (conversation.lastMessage) return `${conversation.lastFrom === 'user' ? '我: ' : ''}${conversation.lastMessage}`
    return `${conversation.memberBotIds.length} 位成员`
  }

  return (
    <div className="grokbot-sidebar" ref={rootRef}>
      <div className="grokbot-sidebar__top"><button className="grokbot-brand" onClick={closeTarget} aria-label="DeepSeekBot 首页">DeepSeekBot</button>
        <button type="button" className="grokbot-iconbtn" title="新建：召唤专家 / 拉群聊 / 与 Bot 单聊" onClick={() => setMenuOpen((v) => !v)}>＋</button>
        <button type="button" className="grokbot-iconbtn" title={nativeVisible ? '隐藏原始列表' : '显示原始工作区/会话列表'} onClick={() => toggleNativeSidebar()}>⇆</button>
      </div>
      <div className="grokbot-sidebar__search">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="搜索" aria-label="搜索" />
      </div>
      {(state?.approvals?.length ?? 0)>0 ? <button className="gk-approval-entry" aria-label={`幕僚长审批：${state?.approvals.filter(a=>a.stage !== 'chief').length ?? 0} 项需要你审批`} onClick={()=>openBot('chief')}>
        {(state?.approvals.filter(a=>a.stage !== 'chief').length ?? 0)>0 ? `需要你审批 · ${state?.approvals.filter(a=>a.stage !== 'chief').length}` : `幕僚长代审中 · ${state?.approvals.length}`}
      </button> : null}
      <div className="grokbot-sidebar__list">
        {menuOpen
          ? (
            <div className="grokbot-newmenu">
              <button type="button" className="grokbot-newmenu__item" disabled={creatingBot} onClick={() => createFromTemplate()}>
                <span className="grokbot-newmenu__icon">➕</span>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{creatingBot ? '正在创建…' : '创建新 Bot'}</span>
                  <span style={{ fontSize: 12, opacity: .55 }}>立即开聊，在对话里选角色和名字</span>
                </span>
              </button>
              <button type="button" className="grokbot-newmenu__item" onClick={() => { setMenuOpen(false); setGrouping(true) }}>
                <span className="grokbot-newmenu__icon">👥</span>创建群聊
              </button>
              {allBots.filter((bot) => !bot.hidden).length > 0 ? <div className="grokbot-newmenu__divider" /> : null}
              {allBots.filter((bot) => !bot.hidden).map((bot) => (
                <button key={bot.id} type="button" className="grokbot-newmenu__item" onClick={() => { setMenuOpen(false); openBot(bot.id) }}>
                  <span className="grokbot-newmenu__icon"><AvatarView seed={bot.id} name={bot.name} glyph={bot.roleTemplate || bot.avatar} size={22} /></span>{bot.name}
                </button>
              ))}
            </div>
          )
          : null}
        {grouping ? <RoomForm bots={allBots.filter((bot) => !bot.hidden)} onCancel={() => setGrouping(false)} onSaved={(roomId) => { setGrouping(false); openRoom(roomId) }} /> : null}
        <div className="grokbot-sidebar__section">{showArchived?'已归档项目':'会话'} <button style={{border:0,background:'transparent',color:'inherit',font:'inherit',cursor:'pointer',marginLeft:8}} onClick={()=>setShowArchived(v=>!v)}>{showArchived?'返回会话':'查看归档'}</button></div>
        {conversations.length === 0 ? <div style={{ fontSize: 12, opacity: .5, padding: '4px 10px' }}>暂无会话，点 ＋ 开始</div> : null}
        {conversations.map((conversation) => {
          const isGroup = conversation.memberBotIds.length > 1
          const bot = isGroup ? undefined : botOf(conversation.memberBotIds[0])
          const working = !isGroup && bot?.status === 'working'
          const stack = isGroup
            ? conversation.memberBotIds.map((botId) => {
                const member = botOf(botId)
                return { seed: botId, name: member?.name, glyph: member?.roleTemplate || member?.avatar }
              })
            : undefined
          return (
            <SidebarRow
              key={conversation.id}
              seed={isGroup ? conversation.id : (bot?.id ?? conversation.id)}
              name={rowTitle(conversation)}
              glyph={isGroup ? 'group' : (bot?.roleTemplate || bot?.avatar)}
              stack={stack && stack.length > 1 ? stack : undefined}
              preview={rowPreview(conversation)}
              time={timeLabel(conversation.lastAt)}
              working={working}
              activity={bot?characterActivity(bot,state):undefined}
              specialty={bot?.title}
              level={!isGroup ? bot?.rating?.level : undefined}
              active={target?.id === conversation.id}
              onClick={() => openConversation(conversation.id)}
            />
          )
        })}
      </div>
      <div className="grokbot-sidebar__foot">
        <button type="button" className="grokbot-sidebar__computer" aria-label="本机工作区与任务成果" title="本机工作区与任务成果" onClick={() => openComputer()}>
          <span className="gk-ico"><NavigationIcon kind="computer" /></span>
          <span className="gk-lbl">电脑</span>

        </button>
        <button type="button" className="grokbot-iconbtn gk-foot-ico" aria-label="例行任务" title="例行任务" onClick={() => { openTarget = { kind: 'routines', id: 'routines' }; notify() }}>
          <span className="gk-ico"><NavigationIcon kind="clock" /></span>
        </button>
        <button type="button" className="grokbot-iconbtn gk-foot-ico" aria-label="团队默认模型" title="团队默认模型" onClick={() => { openTarget = { kind: 'settings', id: 'settings' }; notify() }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--gk-bg-side)"/><circle cx="15" cy="17" r="3" fill="var(--gk-bg-side)"/></svg>
        </button>
      </div>
    </div>
  )
}


function NavigationIcon({ kind }: { kind: 'computer' | 'clock' }): ReactNode {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'computer' ? <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></> : <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}
  </svg>
}

export function RoutinesView({ bots }: { bots: BotInfo[] }): ReactNode {
  const [items, setItems] = useState<RoutineInfo[] | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let alive = true
    setItems(null); setError('')
    api('/routines').then((r) => { if (alive) setItems(r.routines ?? []) })
      .catch((e) => { if (alive) setError(String(e?.message ?? e)) })
    return () => { alive = false }
  }, [revision])
  return <section style={{ padding: '28px 32px', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }} aria-label="例行任务">
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>例行任务</h1>
      <button type="button" style={{ border: '1px solid var(--gk-line)', background: 'transparent', color: 'inherit', borderRadius: 8, padding: '7px 14px', font: 'inherit', fontSize: 14, cursor: 'pointer' }} onClick={() => setRevision((v) => v + 1)}>刷新</button>
    </div>
    <p style={{ color: 'var(--gk-text-2)', fontSize: 14 }}>查看助手的定时安排。打开对应助手，在详情中管理例行任务。</p>
    {error ? <p role="alert">加载失败：{error}。请刷新重试。</p> : items === null ? <p role="status">加载中…</p> : items.length === 0 ? <p>还没有例行任务。在助手右上角打开详情，即可创建。</p> :
      <div style={{ display: 'grid', gap: 10 }}>{items.map((r) => {
        const bot = bots.find((b) => b.id === r.botId)
        return <button key={r.id} type="button" className="grokbot-newmenu__item" disabled={!bot} onClick={() => openBot(r.botId)} style={{ border: '1px solid var(--gk-line)', borderRadius: 12, padding: 14, textAlign: 'left' }}>
          <AvatarView seed={r.botId} name={bot?.name} glyph={bot?.roleTemplate || bot?.avatar} size={32} />
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}><strong>{r.prompt || '例行任务'}</strong><span style={{ display: 'block', marginTop: 5, fontSize: 12, opacity: .65 }}>{bot?.name ?? '助手已不可用'} · {r.schedule.time ? `每天 ${r.schedule.time}` : `每 ${r.schedule.everyMinutes ?? '?'} 分钟`} · {r.enabled ? '已启用' : '已停用'}</span></span>
        </button>
      })}</div>}
  </section>
}

/* ---------------- 共享电脑 · 本机工作区（R-UI） ---------------- */

export function ComputerView(): ReactNode {
  return <ArchiveComputer api={api} onConversation={id=>openConversation(id)} />
}

/* ---------------- 私聊视图 ---------------- */


/* ---------------- 消息内可视化组件 ---------------- */

function SetupWizard(props: { bot: BotInfo; onAdvance: () => void }): ReactNode {
  const { bot } = props
  const [templates, setTemplates] = useState<{ id: string; name: string; avatar: string; title: string; persona: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [customRole, setCustomRole] = useState(false)
  const [customText, setCustomText] = useState('')

  useEffect(() => {
    if (props.bot.setupStage !== 'await-role' || templates.length > 0) return
    void api('/bot-templates').then((outcome) => setTemplates((outcome?.templates ?? []).filter((t: { blank?: boolean; id?: string }) => !t.blank && t.id !== 'chief'))).catch(() => undefined)
  }, [props.bot.setupStage, templates.length])

  const send = useCallback(async (text: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await api(`/conversations/${encodeURIComponent(bot.id)}/chat`, { method: 'POST', body: JSON.stringify({ text }) })
      props.onAdvance()
    } catch { /* 随轮询恢复 */ } finally {
      setBusy(false)
    }
  }, [busy, bot.id, props])

  const stage = bot.setupStage
  const chosenTemplate = stage === 'await-name'
    ? templates.find((template) => (template.title || '').startsWith(bot.title.split(' · ')[0]))
    : null

  return (
    <div className="grokbot-wizard">
      <div className="grokbot-wizard__steps">
        <span className={stage === 'await-role' ? 'on' : stage === 'await-name' ? 'ok' : 'ok'}>① 角色</span>
        <span className={stage === 'await-name' ? 'on' : ''}>② 姓名</span>
        <span>③ 完成</span>
      </div>
      {stage === 'await-role'
        ? (
          <>
            <div className="grokbot-wizard__title">给我一个角色</div>
            <div className="grokbot-wizard__roles">
              {templates.length === 0 ? <div className="grokbot-wizard__hint">加载角色…</div> : null}
              {templates.map((template) => (
                <button key={template.id} type="button" className="grokbot-role" disabled={busy} onClick={() => void send(template.title.split(' · ')[0])}>
                  <AvatarView seed={template.id} glyph={template.id} size={48} />
                  <span className="grokbot-role__name">{template.title.split(' · ')[0]}</span>
                  <span className="grokbot-role__desc">{template.title.split(' · ')[1] || ''}</span>
                </button>
              ))}
            </div>
            {customRole
              ? (
                <div className="grokbot-wizard__custom">
                  <input value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="描述角色，如：懂法律的合规顾问" aria-label="自定义角色" />
                  <button type="button" className="grokbot-form__submit" disabled={busy || customText.trim().length < 2} onClick={() => void send(`我的角色：${customText.trim()}`)}>就这个</button>
                </div>
              )
              : <button type="button" className="grokbot-wizard__skip" onClick={() => setCustomRole(true)}>＋ 自定义角色</button>}
          </>
        )
        : null}
      {stage === 'await-name'
        ? (
          <>
            <div className="grokbot-wizard__title">叫我什么名字？</div>
            {chosenTemplate
              ? (
                <div className="grokbot-wizard__names">
                  {[chosenTemplate.name, chosenTemplate.name.slice(0, 1) + '小' + chosenTemplate.name.slice(1)].map((suggestion) => (
                    <button key={suggestion} type="button" className="grokbot-chips__item" disabled={busy} onClick={() => void send(suggestion)}>{suggestion}</button>
                  ))}
                </div>
              )
              : null}
            <div className="grokbot-wizard__custom">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="输入名字（2-12 字），回车确认" aria-label="名字"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && nameDraft.trim().length >= 2 && !busy) {
                    event.preventDefault()
                    void send(`叫${nameDraft.trim()}`)
                  }
                }} />
              <button type="button" className="grokbot-form__submit" disabled={busy || nameDraft.trim().length < 2} onClick={() => void send(`叫${nameDraft.trim()}`)}>就叫这个</button>
            </div>
          </>
        )
        : null}
      <button type="button" className="grokbot-wizard__skip" disabled={busy} onClick={() => void send('跳过设置')}>跳过设置，直接聊</button>
    </div>
  )
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
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="mavatar" style={{ display:'inline-flex' }}><AvatarView seed={member.id} name={member.name} glyph={member.roleTemplate || member.avatar} size={30} /></span>{member.name}
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
                <span className="grokbot-newmenu__icon"><AvatarView seed={candidate.id} name={candidate.name} glyph={candidate.roleTemplate || candidate.avatar} size={22} /></span>{candidate.name}
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

function ApprovalCard(props: {approval:ApprovalInfo}):ReactNode {
 return <ApprovalView approval={props.approval} onDecision={async(outcome,remember)=>{await api(`/approvals/${encodeURIComponent(props.approval.id)}`,{method:'POST',body:JSON.stringify({outcome,remember})});refreshState?.()}}/>
}
function AccessSettings():ReactNode {
 const [bots,setBots]=useState<{id:string;name:string;mode:string}[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState('')
 const load=()=>api('/access-control').then(r=>setBots(r.bots||[])).catch(e=>setError(e.message))
 useEffect(()=>{void load()},[])
 return <section className="gk-access-settings"><h3>成员权限</h3><p>插件完全访问已停用。操作仍需审核；相同操作可在审批卡中明确记住 24 小时，并在授权规则中撤销。</p>{bots.map(b=><div key={b.id}><span>{b.name}<small>{b.mode==='full'?'完全访问已开启':'由幕僚长审核，必要时交给你'}</small></span>{b.mode==='full'?<button disabled={!!busy} onClick={()=>{setBusy(b.id);setError('');void api(`/bots/${encodeURIComponent(b.id)}/access`,{method:'POST',body:JSON.stringify({mode:'review'})}).then(load).catch(e=>setError(e.message)).finally(()=>setBusy(''))}}>关闭完全访问</button>:null}</div>)}{error?<p role="alert">{error}</p>:null}</section>
}

export function BotChatView(props: { bot: BotInfo; state: GrokbotState | null }): ReactNode {
  const { bot, state } = props
  const propsBots = state?.bots ?? []
  const [draft, setDraft] = useState('')
  const [draftTask, setDraftTask] = useState<{ taskId: string; name: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  // 失败/结果未知时的逻辑请求（按会话隔离存储；重试仅作用于原会话）
  const [retryRequest, setRetryRequest] = useState<{ conversationId: string; requestId: string; text: string; taskId: string | null; createdAt: number } | null>(null)
  const botRef = useRef(bot.id)
  const botGenRef = useRef(0) // 执行代次：每次切换递增——旧回调只能匹配自己的代次
  // 按会话保存未发送草稿/任务引用：模块级 store（切走/卸载不丢，重挂恢复，新会话不继承）
  const liveDraftRef = useRef({ draft, draftTask })
  liveDraftRef.current = { draft, draftTask }
  useEffect(() => {
    if (botRef.current !== bot.id) {
      // 离开旧会话：保存其未发送草稿/任务
      saveDraft(botRef.current, liveDraftRef.current)
      botRef.current = bot.id
      botGenRef.current += 1 // 切换会话 = 新代次（旧回调全部失效）
    }
    // 挂载（含跨视图卸载后重挂）与切换统一恢复本会话草稿
    const saved = loadDraft(bot.id)
    setDraft(saved.draft)
    setDraftTask(saved.draftTask)
    setRetryRequest(getPendingRetry(bot.id))
    // 切换会话（同类视图复用 state）：从会话存储恢复本会话记录，其他会话的记录不串
    setSending(false)
    setEditing(false)
  }, [bot.id])
  // 卸载（父级切换到群/工作区等互斥视图）也保存当前会话草稿——useRef Map 会随卸载销毁
  useEffect(() => () => { saveDraft(botRef.current, liveDraftRef.current) }, [])
  const [newRoutine, setNewRoutine] = useState(false)
  const [catalog, setCatalog] = useState<CatalogProvider[]>([])
  const [historyRefresh, forceRefresh] = useState(0)
  useEffect(() => {
    const subscribers = historyListeners.get(bot.id) ?? new Set<() => void>()
    historyListeners.set(bot.id, subscribers)
    const refresh = () => forceRefresh(n => n + 1)
    subscribers.add(refresh)
    return () => { subscribers.delete(refresh); if (!subscribers.size) historyListeners.delete(bot.id) }
  }, [bot.id])
  const messages = historyOf(bot.id)
  const {ref:logRef, paused:scrollPaused, jumpToLatest} = useChatScroll(`${bot.id}:${historyRefresh}:${sending}:${bot.status}:${bot.currentJob}:${bot.currentRunId}:${cancelling}:${messages.length}:${messages.at(-1)?.text ?? ''}:${JSON.stringify(state?.approvals ?? [])}`, bot.id)
  const pending = (state?.approvals ?? []).filter((approval) => bot.id === 'chief' || approval.botId === bot.id)

  // 服务端 DM 历史拉取：保留 artifact 等透传字段（原件卡片不能在历史加载时丢失）。
  // 写入按会话 latest-wins：旧实例（已卸载视图）或旧一轮的迟到响应不得覆盖较新历史
  const refetchHistory = useCallback(async (): Promise<void> => {
    try {
      const gen = (historyFetchGen.get(bot.id) ?? 0) + 1
      historyFetchGen.set(bot.id, gen)
      const outcome = await api(`/conversations/${encodeURIComponent(bot.id)}`)
      const list = uniqueMessages((outcome?.messages ?? []) as { ts: number; role: string; text: string; messageId?: string; requestId?: string; artifact?: ArtifactInfo | null }[])
      if (list.length === 0) return
      if (historyFetchGen.get(bot.id) !== gen) return // 迟到旧响应：新历史已落（或新一轮在途），丢弃
      const updated = list.map((message, index) => ({
        id: message.messageId || (message.requestId ? `chat-${message.requestId}-${message.role}` : `h${message.ts}-${index}`),
        requestId: message.requestId,
        role: message.role === 'user' ? ('user' as const) : message.role==='system' ? ('activity' as const) : ('bot' as const),
        text: message.text,
        at: message.ts,
        artifact: message.artifact ?? null,
      }))
      const pending = pendingMessages.get(bot.id)
      for (const message of list) if (message.role === 'user' && message.requestId) pending?.delete(message.requestId)
      const merged = [...updated, ...[...(pending?.values() ?? [])]]
      if (JSON.stringify(histories.get(bot.id)) === JSON.stringify(merged)) return
      histories.set(bot.id, merged)
      notifyHistory(bot.id)
    } catch { /* 轮询兜底 */ }
  }, [bot.id])

  useEffect(() => {
    if (sending) return
    const timer=setInterval(()=>void refetchHistory(),2000)
    return ()=>clearInterval(timer)
  }, [bot.id,sending,refetchHistory])

  useEffect(() => {
    // Always reconcile on entry: cached user messages may predate a late reply.
    loadedHistoryFor.add(bot.id)
    void refetchHistory()
  }, [bot.id, refetchHistory])

  useEffect(() => {
    if (catalog.length > 0) return
    void fetchCatalog().then(setCatalog).catch(() => undefined)
  }, [catalog.length])


  // 取消确认复位：按 runId 对齐服务端（run 变了/结束了都可重试或复位），失败不清按钮由 catch 处理
  useEffect(() => {
    if (cancelling && (!bot.currentRunId || bot.currentRunId !== cancelling)) setCancelling(null)
  }, [cancelling, bot.currentRunId])

  const stop = useCallback(async (): Promise<void> => {
    await api(`/bots/${encodeURIComponent(bot.id)}/stop`, { method: 'POST' }).catch(() => undefined)
  }, [bot.id])

  const send = useCallback(async (overrideText?: string, overrideRequest?: { conversationId: string; requestId: string; text: string; taskId: string | null; createdAt?: number }, opts?: { retryMode?: 'retry' }): Promise<void> => {
    const isRetry = Boolean(overrideRequest)
    // 重试仅作用于原会话（当前视图会话不一致时拒绝——URL 永远取当前会话，防打错目标）
    if (isRetry && !retryMatches({ ...overrideRequest!, createdAt: overrideRequest!.createdAt ?? 0 }, bot.id)) return
    const text = (isRetry ? overrideRequest!.text : (overrideText ?? draft)).trim()
    if (!text || sending) return
    const requestId = isRetry ? overrideRequest!.requestId : `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const taskForSend = isRetry ? overrideRequest!.taskId : (draftTask?.taskId ?? null)
    const sendBotId = bot.id // 会话守卫：await 后只写入仍是当前会话的状态
    const sendGen = ++botGenRef.current // 执行代次：同会话新旧两轮也要区分
    const sendSeq = allocateSeq() // 请求序号：旧失败不能覆盖较新的重试槽
    if (!isRetry) setDraft('')
    setRetryRequest(null); clearPendingRetry(bot.id)
    historyFetchGen.set(bot.id, (historyFetchGen.get(bot.id) ?? 0) + 1)
    const pending = pendingMessages.get(bot.id) ?? new Map<string, ChatMessage>()
    pendingMessages.set(bot.id, pending)
    if (!pending.has(requestId) && !historyOf(bot.id).some(m => m.requestId === requestId)) {
      const message: ChatMessage = { id: `chat-${requestId}-user`, requestId, role: 'user', text, at: Date.now() }
      pending.set(requestId, message)
      appendLocal(bot.id, message)
    }
    jumpToLatest()
    setSending(true)
    try {
      const outcome = await api(`/conversations/${encodeURIComponent(bot.id)}/chat`, {
        method: 'POST',
        // retryMode 仅在「查询原结果」时携带；「重新执行」复用原载荷但生成新 ID 走执行路径
        body: JSON.stringify({ text, requestId, ...(taskForSend ? { taskId: taskForSend } : {}), ...(opts?.retryMode ? { retryMode: opts.retryMode } : {}) }),
      })
      // 结算必须无条件执行（作用于原会话的 seq 槽，与当前视图无关）：
      // 切走后到达的成功也要落水印，否则旧迟到失败会合法占据重试槽
      clearPendingRetry(sendBotId, sendSeq)
      if (sendGen !== botGenRef.current) return // 迟到结果：新轮已发起（含切回同会话的第二轮），只丢弃 UI 写入
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
      appendLocal(bot.id, { id: `chat-${requestId}-bot`, requestId, role: 'bot', text: String(outcome?.reply ?? ''), at: Date.now() })
      // 本回合可能有 deliver_file 交付的卡片：以服务端历史为准刷新（立即可见）
      await refetchHistory()
      if (sendGen !== botGenRef.current) return // refetchHistory 也是 await——之后再次验证代次
      setDraftTask(null)
    } catch (error) {
      // 失败记录始终保存到原会话 store（不丢弃），但 UI 写入仅当仍是当前代次
      const pending = { conversationId: sendBotId, requestId, text, taskId: taskForSend, createdAt: isRetry && overrideRequest?.createdAt ? overrideRequest.createdAt : Date.now(), seq: sendSeq }
      setPendingRetry(pending)
      if (sendGen !== botGenRef.current) return // 切走/新轮后不写入当前 UI——但 store 中已有记录供切回恢复
      appendLocal(bot.id, {
        id: `${Date.now()}-e`,
        role: 'error' as const,
        text: String((error as Error)?.message ?? error),
        at: Date.now(),
      })
      setRetryRequest(pending)
    } finally {
      if (sendGen === botGenRef.current) setSending(false)
    }
  }, [draft, sending, bot.id, refetchHistory, draftTask, jumpToLatest])

  const routines = (state?.routines ?? []).filter((routine) => routine.botId === bot.id)

  return (
    <div className="grokbot-chat" onKeyDown={(event) => { if (event.key === 'Escape' && !detailsOpen && !editing) closeTarget() }}>
      <div className="grokbot-chat__head" data-working={bot.status==='working'}>
        <AvatarView seed={bot.id} name={bot.name} glyph={bot.roleTemplate || bot.avatar} size={48} level={bot.rating?.level} activity={characterActivity(bot,state)} specialty={bot.title}/>
        <span className="grokbot-chat__title" onClick={() => setDetailsOpen((v) => !v)}>
          <span className="grokbot-chat__name">{bot.name}</span>
          <span className="grokbot-chat__meta">
            {characterActivity(bot,state).state!=='idle'?characterActivity(bot,state).label:(bot.title || '常驻待命')}
          </span>
        </span>
        {sending
          ? <button type="button" className="grokbot-chat__stop" onClick={() => void stop()}>停止</button>
          : null}
        <button type="button" className="grokbot-iconbtn" title="编辑资料" onClick={() => setEditing((v) => !v)}>⚙</button>
        <button type="button" className="grokbot-chat__close" onClick={closeTarget} aria-label="返回会话首页" title="返回会话首页">←</button>
      </div>
      <BotWorkPanel botId={bot.id} botName={bot.name} />
      {editing ? <div className="gk-profile-overlay"><BotForm key={bot.id} initial={bot} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} /></div> : null}
          {bot.accessMode==='full'?<div className="gk-access-banner"><span>此 Bot 完全访问已开启</span><button onClick={()=>{void api(`/bots/${encodeURIComponent(bot.id)}/access`,{method:'POST',body:JSON.stringify({mode:'review'})}).then(()=>refreshState?.()).catch(e=>window.alert(e.message))}}>关闭完全访问</button></div>:null}
      {bot.setupStage
        ? (
      <div className="grokbot-body">
            <SetupWizard bot={bot} onAdvance={() => refreshState?.()} />
          </div>
        )
        : (
        <>
      <div className="grokbot-body">
        {scrollPaused ? <button type="button" className="grokbot-jump-latest" onClick={jumpToLatest}>↓ 回到最新消息</button> : null}
      <div className="grokbot-log" ref={logRef} tabIndex={0} aria-label="消息记录">
          {messages.length === 0 && pending.length === 0
            ? <div className="grokbot-empty">和 {bot.name} 对话，或投递任务给它。<br />它会真实使用工具、在本机工作区里干活。</div>
            : null}
          {messages.map((message) => {
            const botIdForFb = bot.id
            if (message.role === 'bot') {
              const { body, chips } = splitChips(message.text)
              return (
                <MessageView key={message.id} role="bot" text={body} at={message.at} artifact={message.artifact} onContinueArtifact={(a) => { if (a.taskId) setDraftTask({ taskId: a.taskId, name: a.name }) }}>
                  {chips.length > 0
                    ? (
                      <div className="grokbot-chips">
                        {chips.map((chip) => (
                          <button key={chip} type="button" className="grokbot-chips__item" disabled={sending} onClick={() => void send(chip)}>{chip}</button>
                        ))}
                      </div>
                    )
                    : null}
                  <span className="grokbot-fb">
                    <button type="button" title="干得好 +5" onClick={() => void sendFeedback(botIdForFb, message.id, true)}><img src="/api/plugins/grokbot/assets/rating/thumb-up" width="12" height="12" alt="👍" /></button>
                    <button type="button" title="不满意 -3" onClick={() => void sendFeedback(botIdForFb, message.id, false)}><img src="/api/plugins/grokbot/assets/rating/thumb-down" width="12" height="12" alt="👎" /></button>
                  </span>
                </MessageView>
              )
            }
            const role = message.role === 'user' ? 'user' : message.role === 'error' ? 'error' : 'activity'
            return <MessageView key={message.id} role={role} text={message.text} at={message.at} markdown={false} />
          })}
          {bot.status === 'working' || sending
            ? (
              <TaskCard
                title={bot.currentJob ? `任务 ${bot.currentJob.slice(0, 24)}` : `${bot.name} 正在执行`}
                status="running"
                members={[{ name: bot.name, glyph: bot.roleTemplate || bot.avatar, desc: bot.title || '正在使用本机工具执行任务', state: 'running' }]}
                time={null}
                executor="本机"
                actions={bot.currentRunId && bot.currentTaskId
                  ? [{ label: cancelling === bot.currentRunId ? '停止确认中…' : '取消本次', disabled: cancelling === bot.currentRunId, onClick: () => {
                      const targetRun = bot.currentRunId
                      setCancelling(targetRun ?? null)
                      void api(`/tasks/${encodeURIComponent(bot.currentTaskId!)}/runs/${encodeURIComponent(targetRun!)}/cancel`, { method: 'POST' })
                        .then((r: { ok?: boolean, state?: string, aborted?: boolean }) => {
                          if (!r?.ok || !r?.aborted) {
                            window.alert(`取消未确认：${JSON.stringify(r)}`)
                            setCancelling(null) // 失败/unknown 恢复可重试
                          }
                        })
                        .catch((e: unknown) => { window.alert(`取消失败：${String(e)}`); setCancelling(null) })
                    } }]
                  : (sending ? [{ label: '停止', onClick: () => void stop() }] : [])}
              />
            )
            : null}
          {pending.map((approval) => (
            bot.id === 'chief' ? <ApprovalCard key={approval.id} approval={approval} /> : <div key={approval.id} className="grokbot-msg approval">授权已交给幕僚长处理。<button onClick={()=>openBot('chief')}>查看幕僚长审批</button></div>
          ))}
          {sending && pending.length === 0 ? <div className="grokbot-empty"><img src="/api/plugins/grokbot/assets/states/thinking" width={20} height={20} alt="" style={{verticalAlign:'-4px'}} /> 思考中…</div> : null}
        </div>
        {detailsOpen
          ? (
            <div className="grokbot-details">
              <div>
                <div className="grokbot-details__title">模型（高级设置）</div>
                <select
                  className="gk-modelbar__select"
                  style={{ width: '100%', marginTop: 6, boxSizing: 'border-box' }}
                  value={bot.model ? `${bot.model.provider}/${bot.model.model}` : ''}
                  onChange={(e) => {
                    const val = e.target.value
                    if (!val) { void api(`/bots/${encodeURIComponent(bot.id)}`, { method: 'PATCH', body: JSON.stringify({ model: null }) }).then(() => refreshState?.()).catch(() => undefined); return }
                    const [provider, model] = val.split('/')
                    void api(`/bots/${encodeURIComponent(bot.id)}`, { method: 'PATCH', body: JSON.stringify({ model: { provider, model } }) }).then(() => refreshState?.()).catch(() => undefined)
                  }}
                >
                  <option value="">跟随团队默认</option>
                  {catalog.map((p) => p.models.map((m) => (
                    <option key={`${p.id}/${m.id}`} value={`${p.id}/${m.id}`}>{p.name} / {m.name}</option>
                  )))}
                </select>
                <div className="grokbot-details__hint">{bot.model ? `自定义：${bot.model.provider}/${bot.model.model}` : '未覆盖时沿用宿主默认模型'}</div>
              </div>
              {bot.rating ? (
                <div className="grokbot-rating">
                  <div className="grokbot-rating__head">
                    <img src={`/api/plugins/grokbot/assets/rating/badge-lv${bot.rating?.level ?? 1}`} width={18} height={18} alt="Lv" className="grokbot-rating__level" />
                    <span className="grokbot-rating__title">{bot.rating.title}</span>
                    {bot.rating.stars
                      ? (
                        <span className="grokbot-rating__stars">{Array.from({ length: 5 }, (_, i) => <img key={i} src={`/api/plugins/grokbot/assets/rating/star-${i < (bot.rating?.stars ?? 0) ? 'filled' : 'empty'}`} width={12} height={12} alt="" />)}</span>
                      )
                      : null}
                  </div>
                  <div className="grokbot-rating__bar">
                    <div className="grokbot-rating__fill" style={{ width: `${bot.rating.nextAt ? Math.min(100, Math.round(100 * bot.rating.exp / bot.rating.nextAt)) : 100}%` }} />
                  </div>
                  <div className="grokbot-rating__nums">
                    {bot.rating.nextAt ? `经验 ${bot.rating.exp}/${bot.rating.nextAt}` : '已满级'}
                    {'　'}任务 {bot.rating.tasksDone}✓ {bot.rating.tasksFailed}✗
                    {bot.rating.growth?.reviews ? <div>复盘 {bot.rating.growth.reviews} 次 · 最近 {bot.rating.growth.latest?.score ?? '证据不足'}{bot.rating.growth.latest?.score != null ? '/100' : ''}<br/>改进验证 {bot.rating.growth.verified} 项 · 成长经验 +{bot.rating.growth.exp}{bot.rating.growth.latestUrl?<a href={bot.rating.growth.latestUrl} target="_blank" rel="noreferrer" style={{display:"block",marginTop:6}}>查看最近复盘 ↗</a>:null}</div> : null}
                    {bot.rating.thumbsUp + bot.rating.thumbsDown > 0 ? `　👍${bot.rating.thumbsUp} 👎${bot.rating.thumbsDown}` : ''}
                  </div>
                </div>
              ) : null}
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
      {retryRequest
        ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 22px 0' }}>
            {(() => {
              const risk = retryRiskLevel(retryRequest)
              return (
                <>
                  <span style={{ fontSize: 12, color: 'rgba(176,48,48,.9)' }}>
                    {risk === 'high' ? '上次发送结果未知（「查询原结果」大概率返回已执行的回复）' : risk === 'medium' ? '上次发送结果未知（查询可能命中；记录过期/重启会返回不可恢复提示，不会重复执行）' : '结果未知已超保留期——查询将提示不可恢复；如需继续请「重新执行」'}
                  </span>
                  <button type="button" style={{ border: '1px solid rgba(176,48,48,.4)', background: 'rgba(176,48,48,.06)', color: 'rgba(176,48,48,.9)', borderRadius: 99, padding: '3px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }} disabled={sending} onClick={() => { void send(undefined, retryRequest, { retryMode: 'retry' }) }}>重试本次（查询原结果）</button>
                  <button type="button" style={{ border: '1px solid rgba(29,29,31,.2)', background: 'rgba(29,29,31,.04)', color: 'var(--gk-text)', borderRadius: 99, padding: '3px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }} disabled={sending} onClick={() => { if (window.confirm('重新执行：生成新请求（原执行可能已发生，可能重复）。确认？')) void send(retryRequest.text, { conversationId: retryRequest.conversationId, requestId: `ui-${Date.now().toString(36)}-re`, text: retryRequest.text, taskId: retryRequest.taskId, createdAt: Date.now() }) }}>重新执行</button>
                </>
              )
            })()}
            <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'rgba(29,29,31,.4)', fontSize: 12 }} onClick={() => { setRetryRequest(null); clearPendingRetry(bot.id) }}>放弃</button>
          </div>
        )
        : null}
      {draftTask
        ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 22px 0' }}>
            <span style={{ fontSize: 12, background: 'rgba(37,99,235,.10)', color: '#2563eb', borderRadius: 99, padding: '3px 10px', fontWeight: 600 }}>
              继续修改：{draftTask.name}
            </span>
            <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'rgba(29,29,31,.4)', fontSize: 12 }} onClick={() => setDraftTask(null)}>✕</button>
          </div>
        )
        : null}
      <Composer
        conversationId={bot.id}
        draft={draft}
        onDraft={setDraft}
        onSend={() => void send()}
        sending={sending}
        placeholder={draftTask ? `继续修改 ${draftTask.name}（同一任务）…` : `发消息给 ${bot.name}`}
      />
        </>
      )}
    </div>
  )
}

/* ---------------- 群聊视图 ---------------- */

export function GroupChatView(props: { conversation: ConversationInfo; bots: BotInfo[]; queued?: { jobId: string; botId: string; text: string }[] }): ReactNode {
  const room = { id: props.conversation.id, name: props.conversation.name || props.conversation.memberBotIds.map((botId) => props.bots.find((bot) => bot.id === botId)?.name ?? botId).join('、'), memberBotIds: props.conversation.memberBotIds }
  const bots = props.bots
  const [boardOpen,setBoardOpen]=useState(true)
  const loadBoard=useCallback((id:string)=>api(`/conversations/${encodeURIComponent(id)}/board`),[])
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [draft, setDraft] = useState('')
  const [draftTask, setDraftTask] = useState<{ taskId: string; name: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [cancellingRuns, setCancellingRuns] = useState<Map<string, string>>(new Map())
  const [retryRequest, setRetryRequest] = useState<{ conversationId: string; requestId: string; text: string; taskId: string | null; createdAt: number } | null>(null)
  const roomRef = useRef(room.id)
  const roomGenRef = useRef(0) // 执行代次
  const roomHistoryGen = useRef(0)
  // 按群保存未发送草稿/任务引用：模块级 store（切走/卸载不丢，重挂恢复，新群不继承）
  const liveDraftRef = useRef({ draft, draftTask })
  liveDraftRef.current = { draft, draftTask }
  useEffect(() => {
    if (roomRef.current !== room.id) {
      // 离开旧群：保存未发送草稿/任务
      saveDraft(roomRef.current, liveDraftRef.current)
      roomRef.current = room.id
      roomGenRef.current += 1 // 切换群 = 新代次
    }
    // 挂载（含跨视图卸载后重挂）与切换统一恢复本群草稿
    const saved = loadDraft(room.id)
    setDraft(saved.draft)
    setDraftTask(saved.draftTask)
    setRetryRequest(getPendingRetry(room.id))
    // 切换群：重置发送/取消状态（旧群不阻塞新群）
    setSending(false)
    setCancellingRuns(new Map())
  }, [room.id])
  // 卸载（父级切换到 DM/工作区等互斥视图）也保存当前群草稿
  useEffect(() => () => { saveDraft(roomRef.current, liveDraftRef.current) }, [])
  const queued = props.queued ?? []
  const {ref:logRef, paused:scrollPaused, jumpToLatest} = useChatScroll(`${room.id}:${sending}:${JSON.stringify(messages)}:${JSON.stringify(queued)}:${JSON.stringify(bots.filter(b=>b.currentConversationId===room.id).map(b=>[b.id,b.status,b.currentJob,b.currentRunId]))}:${JSON.stringify([...cancellingRuns])}`, room.id)

  useEffect(() => {
    let alive = true
    const tick = (): void => {
      const gen = ++roomHistoryGen.current
      api(`/conversations/${encodeURIComponent(room.id)}`).then((outcome) => {
        if (alive && gen === roomHistoryGen.current) setMessages(uniqueMessages((outcome?.messages ?? []) as RoomMessage[]))
      }).catch(() => undefined)
    }
    tick()
    const timer = setInterval(tick, 3000)
    return () => { alive = false; clearInterval(timer) }
  }, [room.id])


  // 停止确认复位：按 (botId → 其当前 runId) 与服务端对齐；run 已变/结束即清该项
  useEffect(() => {
    const liveRun = new Map(bots.filter((b) => b.status === 'working' && b.currentRunId).map((b) => [b.id, b.currentRunId]))
    setCancellingRuns((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const [botId, runId] of prev) {
        const now = liveRun.get(botId)
        if (now !== runId) { next.delete(botId); changed = true }
      }
      return changed ? next : prev
    })
  }, [bots])

  const botOf = (botId?: string): BotInfo | undefined => bots.find((bot) => bot.id === botId)

  const send = useCallback(async (overrideRequest?: { conversationId: string; requestId: string; text: string; taskId: string | null; createdAt?: number }, opts?: { retryMode?: 'retry' }): Promise<void> => {
    const isRetry = Boolean(overrideRequest)
    if (isRetry && !retryMatches({ ...overrideRequest!, createdAt: overrideRequest!.createdAt ?? 0 }, room.id)) return
    const text = (isRetry ? overrideRequest!.text : draft).trim()
    if (!text || sending) return
    const requestId = isRetry ? overrideRequest!.requestId : `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const taskForSend = isRetry ? overrideRequest!.taskId : (draftTask?.taskId ?? null)
    const sendRoomId = room.id // 会话守卫
    const sendGen = ++roomGenRef.current // 执行代次：同群新旧两轮也要区分
    const sendSeq = allocateSeq() // 请求序号
    if (!isRetry) setDraft('')
    setRetryRequest(null); clearPendingRetry(room.id)
    setSending(true)
    try {
      const outcome = await api(`/conversations/${encodeURIComponent(room.id)}/chat`, {
        method: 'POST',
        body: JSON.stringify({ text, requestId, ...(taskForSend ? { taskId: taskForSend } : {}), ...(opts?.retryMode ? { retryMode: opts.retryMode } : {}) }),
      })
      // 结算必须无条件执行（作用于原会话的 seq 槽）——切走后到达的成功也要落水印
      clearPendingRetry(sendRoomId, sendSeq)
      if (sendGen !== roomGenRef.current) return // 迟到结果：只丢弃 UI 写入
      ++roomHistoryGen.current
      setMessages(uniqueMessages((outcome?.messages ?? []) as RoomMessage[]))
      setDraftTask(null)
    } catch (error) {
      // 失败记录始终保存到原会话 store（不丢弃），UI 写入仅当仍是当前代次
      const pending = { conversationId: sendRoomId, requestId, text, taskId: taskForSend, createdAt: isRetry && overrideRequest?.createdAt ? overrideRequest.createdAt : Date.now(), seq: sendSeq }
      setPendingRetry(pending)
      if (sendGen !== roomGenRef.current) return // 切走/新轮后不写入当前 UI
      setMessages((prev) => [...prev, { ts: Date.now(), role: 'system', text: `发送失败：${String((error as Error)?.message ?? error)}（可重试本次，复用原请求）` }])
      setRetryRequest(pending)
    } finally {
      if (sendGen === roomGenRef.current) setSending(false)
    }
  }, [draft, sending, room.id, draftTask])

  return (
    <div className="grokbot-group-shell">
    <div className="grokbot-chat" onKeyDown={(event) => { if (event.key === 'Escape' && !detailsOpen) closeTarget() }}>
      <div className="grokbot-chat__head">
        <GroupAvatarView name={room.name} members={room.memberBotIds.map(id => { const m = bots.find(b => b.id === id); return { seed: id, name: m?.name, glyph: m?.roleTemplate || m?.avatar } })} size={48} />
        <span className="grokbot-chat__title" onClick={() => setDetailsOpen((v) => !v)}>
          <span className="grokbot-chat__name">{room.name}</span>
          <span className="grokbot-chat__meta">
            {room.memberBotIds.map((botId) => {
              const m = botOf(botId)
              return <span key={botId} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 10 }}><AvatarView seed={botId} name={m?.name} glyph={m?.roleTemplate || m?.avatar} size={17} /><span>{m?.name ?? botId}</span></span>
            })}
          </span>
        </span>
        <button type="button" className="gk-board-toggle" aria-expanded={boardOpen} onClick={()=>setBoardOpen(v=>!v)}>{boardOpen?'隐藏任务进展':'查看任务进展'}</button>
        <button type="button" className="grokbot-chat__close" onClick={closeTarget} aria-label="返回会话首页" title="返回会话首页">←</button>
      </div>
      <div className="grokbot-body">
      {scrollPaused ? <button type="button" className="grokbot-jump-latest" onClick={jumpToLatest}>↓ 回到最新消息</button> : null}
      <div className="grokbot-log" ref={logRef} tabIndex={0} aria-label="消息记录">
        {messages.length === 0
          ? <div className="grokbot-empty">由幕僚长统一协调，右侧查看团队任务进展。@成员名仍可定向交流。</div>
          : messages.map((message, index) => {
              if (message.role === 'user') {
                return <MessageView key={message.messageId || `${message.ts}-${index}`} role="user" text={message.text} at={message.ts} markdown={false} />
              }
              if (message.role === 'handoff') {
                return (
                  <MessageView key={message.messageId || `${message.ts}-${index}`} role="activity" text={`↪ ${botOf(message.fromBotId)?.name ?? message.fromBotId} → ${botOf(message.toBotId)?.name ?? message.toBotId}：${message.text}`} markdown={false} />
                )
              }
              if (message.role === 'system') {
                return <MessageView key={message.messageId || `${message.ts}-${index}`} role="notice" text={message.text} markdown={false} />
              }
              const bot = botOf(message.botId)
              return (
                <MessageView
                  key={message.messageId || `${message.ts}-${index}`}
                  role="bot"
                  text={splitChips(message.text).body}
                  at={message.ts}
                  senderName={bot?.name ?? message.botId}
                  senderGlyph={bot?.roleTemplate || bot?.avatar}
                  artifact={message.artifact}
                  onContinueArtifact={(a) => { if (a.taskId) setDraftTask({ taskId: a.taskId, name: a.name }) }}
                />
              )
            })}
        {sending ? <div className="grokbot-empty">成员思考中…</div> : null}
        {queued.map((q) => (
          <TaskCard
            key={q.jobId}
            title={`排队中：${String(q.text).slice(0, 30) || '任务'}`}
            status="queued"
            members={[{ name: bots.find((b) => b.id === q.botId)?.name ?? q.botId, glyph: (bots.find((b) => b.id === q.botId)?.roleTemplate || bots.find((b) => b.id === q.botId)?.avatar), desc: '等待执行（当前有任务占用）', state: 'idle' }]}
            actions={[{ label: '取消排队', onClick: () => {
              void api(`/queue/${encodeURIComponent(q.jobId)}/cancel`, { method: 'POST' })
                .catch((e: unknown) => window.alert(`取消排队失败：${String(e)}`))
            } }]}
          />
        ))}
        {bots.filter((b) => b.status === 'working' && b.currentConversationId === room.id && room.memberBotIds.includes(b.id)).map((b) => {
          const stopping = cancellingRuns.get(b.id) === b.currentRunId
          const cancellable = b.currentRunId && b.currentTaskId
          return (
            <TaskCard
              key={b.id}
              title={stopping ? `${b.name} 停止确认中…` : `${b.name} 正在执行任务`}
              status={stopping ? 'confirm-stop' : 'running'}
              members={[{ name: b.name, glyph: b.roleTemplate || b.avatar, desc: b.title || '使用本机工具执行', state: 'running' }]}
              executor="本机"
              actions={cancellable
                ? [{ label: stopping ? '停止确认中…' : '取消本次', disabled: stopping, onClick: () => {
                    const targetRun = b.currentRunId!
                    setCancellingRuns((prev) => new Map(prev).set(b.id, targetRun))
                    void api(`/tasks/${encodeURIComponent(b.currentTaskId!)}/runs/${encodeURIComponent(targetRun)}/cancel`, { method: 'POST' })
                      .then((r: { ok?: boolean, aborted?: boolean }) => {
                        if (!r?.ok || !r?.aborted) {
                          window.alert(`取消未确认：${JSON.stringify(r)}`)
                          setCancellingRuns((prev) => { const n = new Map(prev); n.delete(b.id); return n })
                        }
                      })
                      .catch((e: unknown) => {
                        window.alert(`取消失败：${String(e)}`)
                        setCancellingRuns((prev) => { const n = new Map(prev); n.delete(b.id); return n })
                      })
                  } }]
                : [{ label: '停止', onClick: () => { void api(`/bots/${encodeURIComponent(b.id)}/stop`, { method: 'POST' }).catch(() => undefined) } }]}
            />
          )
        })}
      </div>
      </div>
      {retryRequest
        ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 22px 0' }}>
            {(() => {
              const risk = retryRiskLevel(retryRequest)
              return (
                <>
                  <span style={{ fontSize: 12, color: 'rgba(176,48,48,.9)' }}>
                    {risk === 'high' ? '上次发送结果未知（「查询原结果」大概率返回已执行的回复）' : risk === 'medium' ? '上次发送结果未知（查询可能命中；记录过期/重启会返回不可恢复提示，不会重复执行）' : '结果未知已超保留期——查询将提示不可恢复；如需继续请「重新执行」'}
                  </span>
                  <button type="button" style={{ border: '1px solid rgba(176,48,48,.4)', background: 'rgba(176,48,48,.06)', color: 'rgba(176,48,48,.9)', borderRadius: 99, padding: '3px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }} disabled={sending} onClick={() => { void send(retryRequest, { retryMode: 'retry' }) }}>重试本次（查询原结果）</button>
                  <button type="button" style={{ border: '1px solid rgba(29,29,31,.2)', background: 'rgba(29,29,31,.04)', color: 'var(--gk-text)', borderRadius: 99, padding: '3px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }} disabled={sending} onClick={() => { if (window.confirm('重新执行：生成新请求（原执行可能已发生，可能重复）。确认？')) void send({ conversationId: retryRequest.conversationId, requestId: `ui-${Date.now().toString(36)}-re`, text: retryRequest.text, taskId: retryRequest.taskId, createdAt: Date.now() }) }}>重新执行</button>
                </>
              )
            })()}
            <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'rgba(29,29,31,.4)', fontSize: 12 }} onClick={() => { setRetryRequest(null); clearPendingRetry(room.id) }}>放弃</button>
          </div>
        )
        : null}
      {draftTask
        ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 22px 0' }}>
            <span style={{ fontSize: 12, background: 'rgba(37,99,235,.10)', color: '#2563eb', borderRadius: 99, padding: '3px 10px', fontWeight: 600 }}>
              继续修改：{draftTask.name}
            </span>
            <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'rgba(29,29,31,.4)', fontSize: 12 }} onClick={() => setDraftTask(null)}>✕</button>
          </div>
        )
        : null}
      <Composer
        conversationId={room.id}
        draft={draft}
        onDraft={setDraft}
        onSend={() => void send()}
        sending={sending}
        placeholder={draftTask ? `继续修改 ${draftTask.name}（同一任务）…` : room.memberBotIds.includes('chief') ? '告诉幕僚长你的需求…' : `发到 ${room.name}…` }
      />
      {detailsOpen
        ? (
          <div className="grokbot-details">
            <MembersPanel conversation={{ id: room.id, name: room.name, memberBotIds: room.memberBotIds }} bots={bots} onChanged={() => refreshState?.()} />
          </div>
        )
        : null}
    </div>
    {boardOpen?<ProjectBoard conversationId={room.id} bots={bots.filter(b=>room.memberBotIds.includes(b.id))} load={loadBoard} onBot={id=>{focusBotWork(id);openBot(id)}} onApproval={()=>openBot('chief')}/>:null}
    </div>
  )
}

/* ---------------- 主区接管 ---------------- */

let creatingBotBusy = false
function startCreatingBot(): void {
  if (creatingBotBusy) return
  openTarget = null
  setCreatingUi(true)
  creatingBotBusy = true
  void api('/bots', { method: 'POST', body: JSON.stringify({}) })
    .then((outcome) => {
      const id = String(outcome?.bot?.id || '')
      if (id) openBot(id)
    })
    .catch(() => undefined)
    .finally(() => {
      creatingBotBusy = false
      setCreatingUi(false)
    })
}

/* 空态欢迎页：可见的新建/选助手入口（Codex R1 收尾：不把空白当欢迎页） */
function HomeBlank({bots:allBots,state}:{bots:BotInfo[];state:GrokbotState|null}):ReactNode {
 const bots=allBots.filter(b=>!b.hidden),chief=bots.find(b=>b.id==='chief'),members=bots.filter(b=>b.id!=='chief')
 const lead=chief?.status==='working'?chief.id:members.find(b=>b.status==='working')?.id||chief?.id
 const avatar=(bot:BotInfo,size:number)=><AvatarView seed={bot.id} name={bot.name} glyph={bot.roleTemplate||bot.avatar} size={size} level={bot.rating?.level} activity={characterActivity(bot,state)} quiet={bot.id!==lead} specialty={bot.title}/>
 const description=(bot:BotInfo)=>{const activity=characterActivity(bot,state);return activity.state==='idle'?(bot.title||'团队成员'):activity.label}
 return <div className="grokbot-home"><section className="grokbot-home__content">
  <div className="grokbot-home__eyebrow">DEEPSEEKBOT / TEAM</div>
  <h1 className="grokbot-home__title">今天，一起做点什么。</h1>
  <p className="grokbot-home__sub">{state?.stale?'正在重新同步团队状态。':'你的团队已就位。'}</p>
  {chief?<button className="grokbot-home__chief" onClick={()=>openConversation(chief.id)} aria-label={`与${chief.name}对话`}>
   {avatar(chief,64)}<span><strong>{chief.name}</strong><small>{characterActivity(chief,state).state==='idle'?'把想法交给我。':description(chief)}</small></span><span className="grokbot-home__arrow" aria-hidden="true">→</span>
  </button>:<button className="grokbot-home__textlink" onClick={()=>startCreatingBot()}>添加第一位成员 →</button>}
  <div className="grokbot-home__section"><span>团队</span><button className="grokbot-home__textlink" onClick={()=>startCreatingBot()}>添加成员 ↗</button></div>
  <div className="grokbot-home__grid">{members.map(bot=><button className="grokbot-home__member" key={bot.id} onClick={()=>openConversation(bot.id)}>{avatar(bot,52)}<span><strong>{bot.name}</strong><small>{description(bot)}</small></span></button>)}</div>
  <div className="grokbot-home__utilities"><button onClick={()=>{openTarget={kind:'settings',id:'settings'};notify()}}>团队设置</button><button onClick={()=>{openTarget={kind:'permissions',id:'permissions'};notify()}}>授权规则</button></div>
 </section></div>
}

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
  // R1：私聊默认也用 Grok 风格视图（统一私聊/群组件，v3 §3）；原生 DSH 视图经 ⇆ 显式切回
  const isComputer = target?.kind === 'computer'
  const activeKey = nativeVisible
    ? null
    : (target ? `conversation:${target.id}` : (creatingUi ? 'creating' : 'home'))
  const entering = Boolean(target) && !conversation
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  // 动态管理 body class：单聊释放主区（DSH 原生显示），群聊/空白保持 CSS 接管
  useEffect(() => {
    if (activeKey) {
      document.body.classList.add('grokbot-takeover')
    } else {
      document.body.classList.remove('grokbot-takeover')
    }
  }, [activeKey])

  useEffect(() => {
    if (!activeKey) return
    // centerCol 可能晚于本组件挂载（首屏竞态）：MutationObserver 持续等它出现
    let center: HTMLElement | null = document.querySelector('[class*="centerCol"]') as HTMLElement | null
    let resizeObserver: ResizeObserver | null = null
    const takeover = (): void => {
      if (!center) return
      const rect = center.getBoundingClientRect()
      setBox({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    }
    const attach = (el: HTMLElement): void => {
      center = el
      resizeObserver?.disconnect()
      resizeObserver = new ResizeObserver(takeover)
      resizeObserver.observe(el)
      takeover()
    }
    const mo = new MutationObserver(() => {
      const el = document.querySelector('[class*="centerCol"]') as HTMLElement | null
      if (el) { mo.disconnect(); attach(el) }
    })
    if (center) attach(center)
    else mo.observe(document.documentElement, { childList: true, subtree: true })
    window.addEventListener('resize', takeover)
    return () => {
      mo.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener('resize', takeover)
    }
  }, [activeKey])

  if (!box || !activeKey) return null
  return (
    <div
      className="grokbot-chat grokbot-chat--main"
      style={{ position: 'fixed', left: box.left, top: box.top, width: box.width, height: box.height, zIndex: 900 }}
    >
      {(() => {
        if(target?.kind==='permissions')return <PermissionRules api={api} bots={state?.bots||[]} onBack={closeTarget}/>
        if (target?.kind === 'settings') return <ModelSettingsView accessSupported={state?.accessControl?.supported} />
        if (target?.kind === 'routines') return <RoutinesView bots={state?.bots ?? []} />
        if (isComputer) return <ComputerView />
        if (bot) return <BotChatView bot={bot} state={state} />
        if (conversation && isGroup) return <GroupChatView conversation={conversation} bots={state?.bots ?? []} queued={(state?.queued ?? []).filter((q) => q.conversationId === conversation.id)} />
        if (creatingUi || entering) {
          return (
            <div className="grokbot-creating">
              <div className="grokbot-creating__spinner" />
              <div>{entering ? '正在进入会话…' : '正在召唤专家…'}</div>
            </div>
          )
        }
        return <HomeBlank bots={state?.bots ?? []} state={state} />
      })()}
    </div>
  )
}

export const inject = ['slots', 'sessions']

let sessionsService: any = null

export function apply(ctx: any): void {
  sessionsService = ctx.sessions || null

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshGrokbot = ''
    document.head.append(style)
    const update = (): void => {
      const css = GROKBOT_CSS + GKF_CSS + UX_CSS + CHARACTER_CSS + (nativeSidebarVisible ? '' : '\n.grokbot-takeover [class*="centerCol"] > * { display: none !important; }\n.grokbot-takeover [class*="detailsCol"] { display: none !important; }')
      if (style.textContent !== css) style.textContent = css
    }
    update()
    listeners.add(update)
    return () => { listeners.delete(update); style.remove() }
  }, 'grokbot: styles + takeover CSS')

  ctx.slots.inject('sidebar.workspaces', () => {
    try {
      ctx.slots.register({
        name: 'sidebar.workspaces',
        id: 'grokbot-crew',
        order: -100,
      }, GrokbotSidebarCrew)
    } catch (error) {
      console.error('[grokbot] sidebar slot 注册失败', error)
    }
  })

  // body class 由 GrokbotMainView 的 activeKey effect 动态管理（单聊释放/群聊接管）
  // 这里不再静态添加，避免单聊时 CSS 隐藏主区

  ctx.slots.inject('shell.overlay', () => {
    try {
      ctx.slots.register({
        name: 'shell.overlay',
        id: 'grokbot-main',
        order: 51,
      }, GrokbotMainView)
    } catch (error) {
      console.error('[grokbot] overlay slot 注册失败', error)
    }
  })
}
