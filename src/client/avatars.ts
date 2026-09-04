/**
 * 参数化果冻豆头像引擎——基于 Codex 交付的 parts-library 坐标体系。
 * 组合：豆身(12色板) + 大眼高光 + 腮红 + 嘴(4) + 头顶(4) + 内景(3) + 角色配件
 */

/* ---------- 色板（ASSEMBLY.md 12 色） ---------- */
export const PALETTES: [string, string, string][] = [
  ['#8fb0ff', '#4c5fd7', '#24304d'], // blueberry
  ['#6fe0b4', '#1f9d72', '#12291f'], // mint
  ['#ffd98a', '#f08c1d', '#3d2a05'], // apricot
  ['#dcb4ff', '#8b46eb', '#241238'], // grape
  ['#a3e8ff', '#2f9dc4', '#0b3346'], // aqua
  ['#ffb3b3', '#e85660', '#4d1218'], // coral
  ['#ccd9ef', '#5f7cad', '#1c2a4d'], // slate
  ['#bdf2cf', '#3aa866', '#0c3a20'], // leaf
  ['#ffd6e4', '#e8739c', '#4d1230'], // rose
  ['#dcd6ff', '#7a68d4', '#2d2450'], // lilac
  ['#ffe3ae', '#c9a34e', '#4d3a10'], // honey
  ['#fff3d6', '#e8c88a', '#5c4a20'], // cream
]
export const PALETTE_NAMES = ['blueberry','mint','apricot','grape','aqua','coral','slate','leaf','rose','lilac','honey','cream']

/* ---------- 角色定义 ---------- */
export interface RoleDef {
  palette: number
  mouth: 'smile' | 'o' | 'w' | 'wave'
  top: 'none' | 'tuft' | 'round' | 'point'
  internal?: 'none' | 'bubbles' | 'sparkles'
  accessory?: string // SVG path 叠加
}

export const ROLE_DEFS: Record<string, RoleDef> = {
  chief:     { palette: 0, mouth: 'o',    top: 'round', accessory: 'crown+star' },
  coder:     { palette: 1, mouth: 'smile', top: 'point', accessory: 'glasses' },
  researcher:{ palette: 2, mouth: 'w',    top: 'point', accessory: 'magnifier' },
  writer:    { palette: 3, mouth: 'wave', top: 'tuft',  accessory: 'pen' },
  analyst:   { palette: 4, mouth: 'o',    top: 'point', accessory: 'cross-eye' },
  pm:        { palette: 5, mouth: 'smile', top: 'tuft', accessory: 'kanban' },
  ops:       { palette: 6, mouth: 'smile', top: 'tuft', accessory: 'antenna' },
  translator:{ palette: 7, mouth: 'smile', top: 'round', accessory: 'globe' },
  secretary: { palette: 8, mouth: 'wave', top: 'tuft',  accessory: 'sparkle' },
  reviewer:  { palette: 9, mouth: 'smile', top: 'point', accessory: 'star-eye' },
  blank:     { palette: 11, mouth: 'o',   top: 'none' },
  group:     { palette: 6, mouth: 'smile', top: 'none', accessory: 'cloud' },
  // 关键词族
  'kw-shield':  { palette: 10, mouth: 'smile', top: 'none', accessory: 'shield' },
  'kw-scales':  { palette: 6,  mouth: 'smile', top: 'none', accessory: 'scales' },
  'kw-book':    { palette: 7,  mouth: 'smile', top: 'none', accessory: 'book' },
  'kw-gear':    { palette: 4,  mouth: 'smile', top: 'none', accessory: 'gear' },
  'kw-note':    { palette: 8,  mouth: 'wave',  top: 'none', accessory: 'note' },
  'kw-flame':   { palette: 5,  mouth: 'smile', top: 'none', accessory: 'flame' },
}

/* ---------- 哈希 → 拼装参数（ASSEMBLY.md 契约） ---------- */
export function hashName(name: string): [number, number, number, number] {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  const h2 = (h >>> 16) ^ h
  const h3 = (h2 >>> 8) ^ h
  const h4 = (h3 >>> 24) ^ h2
  return [Math.abs(h) % 12, Math.abs(h2) % 4, Math.abs(h3) % 3, Math.abs(h4) % 4]
}

/* ---------- SVG 组件路径 ---------- */

function bodyPath(top: string, bot: string): string {
  return `<defs><linearGradient id="gk-av" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bot}"/></linearGradient></defs>
<path d="M11 37C10 25 20 17 33 17c14 0 23 8 22 19-1 12-11 16-23 16S13 49 11 37z" fill="url(#gk-av)"/>
<ellipse cx="26" cy="22" rx="6" ry="2.8" fill="#fff" opacity=".45"/>`
}

function eyes(inset: string): string {
  return `<ellipse cx="24" cy="32" rx="5.5" ry="6.5" fill="#fff"/><ellipse cx="40" cy="32" rx="5.5" ry="6.5" fill="#fff"/>
<circle cx="25.2" cy="33.4" rx="3.2" ry="3.2" fill="${inset}"/><circle cx="41.2" cy="33.4" rx="3.2" ry="3.2" fill="${inset}"/>
<circle cx="24" cy="31.8" r="1.2" fill="#fff"/><circle cx="40" cy="31.8" r="1.2" fill="#fff"/>
<circle cx="26.4" cy="35" r=".6" fill="#fff" opacity=".3"/><circle cx="42.4" cy="35" r=".6" fill="#fff" opacity=".3"/>`
}

function blush(): string {
  return `<ellipse cx="15.5" cy="37" rx="3.2" ry="2" fill="#f58fa9" opacity=".55"/><ellipse cx="48.5" cy="37" rx="3.2" ry="2" fill="#f58fa9" opacity=".55"/>`
}

function mouth(type: string, inset: string): string {
  const s = `stroke="${inset}" stroke-width="3" stroke-linecap="round" fill="none"`
  switch (type) {
    case 'o': return `<ellipse cx="32" cy="42" rx="3.2" ry="2.2" fill="${inset}"/>`
    case 'w': return `<path d="M27 42l2.5 2.5 2.5-2.5 2.5 2.5 2.5-2.5" ${s}/>`
    case 'wave': return `<path d="M27 42q2.5 3 5 0t5 0" ${s}/>`
    default: return `<path d="M27 42q5 4 10 0" ${s}/>` // smile
  }
}

function topType(type: string, color: string, dark: string): string {
  switch (type) {
    case 'tuft': return `<path d="M32 12c-2.5 5-1 9 .5 11.5 1.5-2.5 3-6.5.5-11.5z" fill="${dark}"/><path d="M31.2 13.5c-1 3-.3 5.5.8 7.6l1.6-1.6c-.7-1.6-1.6-3.6-2.4-6z" fill="#ffc5d7"/>`
    case 'round': return `<circle cx="15" cy="15" r="7" fill="${color}"/><circle cx="49" cy="15" r="7" fill="${color}"/><circle cx="15" cy="15" r="3.5" fill="#ffc5d7"/><circle cx="49" cy="15" r="3.5" fill="#ffc5d7"/>`
    case 'point': return `<path d="M20 18C16 9 18 4 22 4c4 0 6 5 5.6 13z" fill="${color}"/><path d="M44 18C48 9 46 4 42 4c-4 0-6 5-5.6 13z" fill="${color}"/><path d="M21.8 16C19.6 10 20.4 7 22.4 7c2 0 3 3 3.2 8z" fill="#ffc5d7"/><path d="M42.2 16C44.4 10 43.6 7 41.6 7c-2 0-3 3-3.2 8z" fill="#ffc5d7"/>`
    default: return ''
  }
}

function internal(type: string): string {
  if (type === 'bubbles') return `<circle cx="20" cy="24" r="3" fill="#fff" opacity=".5"/><circle cx="45" cy="21" r="2" fill="#fff" opacity=".4"/><circle cx="46" cy="45" r="2.6" fill="#fff" opacity=".4"/>`
  if (type === 'sparkles') return `<path d="M40 44l1.2 2.4 2.4 1.2-2.4 1.2L40 51l-1.2-2.4-2.4-1.2 2.4-1.2z" fill="#fff" opacity=".7"/><circle cx="20" cy="22" r="1.6" fill="#fff" opacity=".5"/>`
  return ''
}

/* ---------- 角色配件 ---------- */
function accessory(type: string, inset: string): string {
  switch (type) {
    case 'crown+star': return `<path d="M25 8l2 4 4.4-2.2-.8 4.6 3.2 2.6-4.4.8-1.6 4-2.6-3.2-4.4.8 2.4-4-1.6-4 4 1z" fill="#ffd84d" stroke="#fff" stroke-width="1.4"/><path d="M24 26l1.4 3 3 1.4-3 1.4-1.4 3-1.4-3-3-1.4 3-1.4z" fill="#fff"/><path d="M40 26l1.4 3 3 1.4-3 1.4-1.4 3-1.4-3-3-1.4 3-1.4z" fill="#fff"/>`
    case 'glasses': return `<circle cx="24" cy="32" r="7" fill="none" stroke="${inset}" stroke-width="2.6"/><circle cx="42" cy="32" r="7" fill="none" stroke="${inset}" stroke-width="2.6"/><path d="M31 32h4" stroke="${inset}" stroke-width="2.6"/>`
    case 'magnifier': return `<circle cx="49" cy="27" r="6.5" fill="none" stroke="#3d2a05" stroke-width="2.8"/><path d="M54 32l4 4" stroke="#3d2a05" stroke-width="3.2" stroke-linecap="round"/>`
    case 'pen': return `<path d="M43 38l6 11" stroke="#3d2a05" stroke-width="3" stroke-linecap="round"/><path d="M41.4 37.4l3.4-2.8 3.8 4.4-3.4 2z" fill="#ffd84d" stroke="#3d2a05" stroke-width="1.4"/>`
    case 'cross-eye': return `<path d="M20.4 32h7.2M24 28.4v7.2M36.4 32h7.2M40 28.4v7.2" stroke="${inset}" stroke-width="2.8" stroke-linecap="round"/>`
    case 'kanban': return `<rect x="17" y="28" width="12" height="10" rx="3" fill="none" stroke="${inset}" stroke-width="2.4"/><rect x="35" y="28" width="12" height="10" rx="3" fill="none" stroke="${inset}" stroke-width="2.4"/><path d="M29 33h6" stroke="${inset}" stroke-width="2.4"/>`
    case 'antenna': return `<path d="M32 8v8" stroke="${inset}" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="7" r="2.8" fill="#ffd84d"/><rect x="16" y="30" width="32" height="7" rx="3.4" fill="none" stroke="${inset}" stroke-width="2.4"/><circle cx="22" cy="33.5" r="1.8" fill="${inset}"/><path d="M30 33.5h12" stroke="${inset}" stroke-width="2.2" stroke-linecap="round"/>`
    case 'globe': return `<circle cx="24" cy="32" r="7" fill="none" stroke="${inset}" stroke-width="2.4"/><path d="M24 25v14M17.5 32h13M19 27.5c3.4 3 3.4 6.5 0 9.4M29 27.5c-3.4 3-3.4 6.5 0 9.4" stroke="${inset}" stroke-width="1.6" fill="none"/>`
    case 'sparkle': return `<path d="M15 28l1.6 3.2 3.2 1.6-3.2 1.6L15 38l-1.6-3.2-3.2-1.6 3.2-1.6z" fill="#fff" opacity=".7"/>`
    case 'star-eye': return `<path d="M23 28l1.8 3.8 3.8 1.8-3.8 1.8-1.8 3.8-1.8-3.8-3.8-1.8 3.8-1.8z" fill="#fff"/><path d="M41 28l1.8 3.8 3.8 1.8-3.8 1.8-1.8 3.8-1.8-3.8-3.8-1.8 3.8-1.8z" fill="#fff"/>`
    case 'cloud': return `<path d="M6 30c0-8 7-13 14-12 2-6 12-7 15-1 7-2 13 3 12 9 6 1 9 8 4 12 3 6-2 12-9 11-5 4-12 4-16-1-6 3-14 0-16-6-6-1-9-7-4-12z" fill="#8ba3bd"/><circle cx="20" cy="28" r="3" fill="#fff"/><circle cx="34" cy="26" r="3" fill="#fff"/><circle cx="46" cy="31" r="3" fill="#fff"/><path d="M24 36q4 3.4 8 0M40 36q4 3.4 8 0" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
    default: return ''
  }
}

/* ---------- 主渲染 ---------- */
export function renderAvatarSVG(opts: {
  role?: string        // roleTemplate id
  name?: string        // 用于哈希（自定义时）
  keywordHit?: string  // kw-shield etc
  size?: number
}): string {
  const { role, name, keywordHit, size = 64 } = opts

  let def: RoleDef | undefined
  if (role && ROLE_DEFS[role]) def = ROLE_DEFS[role]
  else if (keywordHit && ROLE_DEFS[keywordHit]) def = ROLE_DEFS[keywordHit]
  else if (role === 'group') def = ROLE_DEFS.group

  if (!def && name) {
    const [p, m, i, t] = hashName(name)
    def = { palette: p, mouth: (['smile','o','w','wave'] as const)[m], top: (['none','tuft','round','point'] as const)[t], internal: (['none','bubbles','sparkles'] as const)[i] }
  }
  if (!def) def = ROLE_DEFS.blank

  const [topColor, botColor, inset] = PALETTES[def.palette % PALETTES.length]

  const parts = [
    topType(def.top, botColor, botColor),
    bodyPath(topColor, botColor),
    internal(def.internal || 'none'),
    eyes(inset),
    blush(),
    mouth(def.mouth, inset),
    accessory(def.accessory || '', inset),
  ].filter(Boolean).join('\n')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${parts}</svg>`
}

/* ---------- 等级叠加层 ---------- */
export function renderLevelRing(level: number): string {
  if (level < 4) return ''
  if (level >= 5) {
    return `<circle cx="32" cy="32" r="30" fill="none" stroke="url(#gold)" stroke-width="2.5"/><defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffd700"/><stop offset="1" stop-color="#b8860b"/></linearGradient></defs><path d="M50 8l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5z" fill="#ffd700" stroke="#fff" stroke-width="1"/>`
  }
  return `<circle cx="32" cy="32" r="30" fill="none" stroke="#daa520" stroke-width="2" opacity=".8"/>`
}

/* ---------- 徽章 ---------- */
export function renderBadge(level: number): string {
  const titles = ['', '见习', '熟练', '资深', '专家', '大师']
  const colors = ['', '#a0a0a0', '#cd7f32', '#c0c0c0', '#ffd700', '#ffd700']
  const bg = colors[level] || '#a0a0a0'
  const crown = level >= 5 ? `<path d="M8 9l1.5 3 3-1.5-.6 3 2 1.6-3 .6-1 2.5-1.6-2-3 .6 1.5-2.5-1-2.5 2.5.6z" fill="#fff" opacity=".9"/>` : ''
  return `<svg viewBox="0 0 20 20" width="16" height="16"><rect x="1" y="1" width="18" height="18" rx="6" fill="${bg}" opacity=".2" stroke="${bg}" stroke-width="1.5"/><text x="10" y="13" text-anchor="middle" font-size="8" font-weight="700" fill="${bg}" font-family="sans-serif">${level}${crown}</text></svg>`
}

/* ---------- 星星 ---------- */
export function renderStar(filled: boolean): string {
  const fill = filled ? '#f5a623' : 'none'
  const stroke = filled ? '#f5a623' : 'rgba(29,29,31,.2)'
  return `<svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 2l2.6 6.6L22 9.2l-5.4 4.6L18.2 21 12 17.2 5.8 21l1.6-7.2L2 9.2l7.4-.6z" fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/></svg>`
}

/* ---------- 状态图标 ---------- */
export function renderStateIcon(state: 'thinking' | 'working' | 'success' | 'error' | 'idle'): string {
  const size = 20
  switch (state) {
    case 'thinking':
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><circle cx="6" cy="12" r="3" fill="#3b82f6" opacity=".4"><animate attributeName="opacity" values=".4;1;.4" dur="1s" repeatCount="indefinite"/></circle><circle cx="12" cy="12" r="3" fill="#3b82f6" opacity=".6"><animate attributeName="opacity" values=".6;1;.6" dur="1s" begin=".2s" repeatCount="indefinite"/></circle><circle cx="18" cy="12" r="3" fill="#3b82f6" opacity=".8"><animate attributeName="opacity" values=".8;1;.8" dur="1s" begin=".4s" repeatCount="indefinite"/></circle></svg>`
    case 'working':
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z" fill="none" stroke="#f0883e" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="14 42"><animateTransform attributeName="transform" type="rotate" values="0 12 12;360 12 12" dur="1s" repeatCount="indefinite"/></path></svg>`
    case 'success':
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><circle cx="12" cy="12" r="10" fill="#22c55e" opacity=".15"/><path d="M8 12l3 3 5-6" stroke="#22c55e" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    case 'error':
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><circle cx="12" cy="12" r="10" fill="#ef4444" opacity=".15"/><path d="M9 9l6 6M15 9l-6 6" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/></svg>`
    default:
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><circle cx="12" cy="12" r="8" fill="none" stroke="rgba(29,29,31,.15)" stroke-width="2"/></svg>`
  }
}
