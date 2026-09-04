import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/

export const DEFAULT_CREW = {
  routing: { default: 'chief' },
  bots: [
    {
      id: 'chief',
      name: '幕僚长',
      avatar: '🎖️',
      persona: '你是常驻桌面 agent 团队的幕僚长。用简体中文回复。用户投递的任务由你直接处理；处理不了时在回复里说明需要哪类专家。只汇报真实完成的操作。',
      workspace: '',
      model: null,
    },
  ],
}

function normalizeBot(raw, index) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`crew.bots[${index}] 必须是对象`)
  }
  const id = String(raw.id || '').trim()
  if (!SAFE_ID_RE.test(id)) {
    throw new Error(`crew.bots[${index}].id 非法：${id}（只允许字母数字._-）`)
  }
  const model = raw.model && (raw.model.provider || raw.model.model)
    ? { provider: String(raw.model.provider || ''), model: String(raw.model.model || '') }
    : null
  return {
    id,
    name: String(raw.name || id).trim() || id,
    avatar: String(raw.avatar || '🤖').trim() || '🤖',
    title: String(raw.title || '').trim(),
    persona: String(raw.persona || '').trim(),
    workspace: String(raw.workspace || '').trim(),
    model,
    pinned: raw.pinned === true,
    section: String(raw.section || '').trim(),
    hidden: raw.hidden === true,
  }
}

function normalizeConversation(raw, index, ids) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`crew.conversations[${index}] 必须是对象`)
  }
  const id = String(raw.id || '').trim()
  if (!SAFE_ID_RE.test(id)) {
    throw new Error(`crew.conversations[${index}].id 非法：${id}`)
  }
  const members = Array.isArray(raw.memberBotIds) ? raw.memberBotIds.map(String) : []
  if (members.length < 1 || members.length > 6) {
    throw new Error(`会话 ${id} 成员数须在 1-6（1=私聊，2-6=群聊）`)
  }
  for (const memberId of members) {
    if (!ids.has(memberId)) throw new Error(`会话 ${id} 成员不存在：${memberId}`)
  }
  return { id, name: String(raw.name || '').trim(), memberBotIds: [...new Set(members)] }
}

function normalizeRoutine(raw, index, ids) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`crew.routines[${index}] 必须是对象`)
  }
  const id = String(raw.id || '').trim()
  if (!SAFE_ID_RE.test(id)) {
    throw new Error(`crew.routines[${index}].id 非法：${id}`)
  }
  const botId = String(raw.botId || '').trim()
  if (!ids.has(botId)) throw new Error(`routine ${id} 归属 bot 不存在：${botId}`)
  const schedule = raw.schedule && typeof raw.schedule === 'object' ? raw.schedule : {}
  const everyMinutes = Number(schedule.everyMinutes)
  const time = String(schedule.time || '').trim()
  if (!(Number.isInteger(everyMinutes) && everyMinutes >= 1) && !/^\d{1,2}:\d{2}$/.test(time)) {
    throw new Error(`routine ${id} 的 schedule 须为 everyMinutes(分钟) 或 time(HH:MM)`)
  }
  const prompt = String(raw.prompt || '').trim()
  if (!prompt) throw new Error(`routine ${id} 缺少 prompt`)
  return {
    id,
    botId,
    prompt,
    schedule: Number.isInteger(everyMinutes) && everyMinutes >= 1 ? { everyMinutes } : { time },
    enabled: raw.enabled !== false,
  }
}

export function parseCrew(text) {
  const raw = JSON.parse(text)
  const bots = Array.isArray(raw?.bots) && raw.bots.length > 0 ? raw.bots : DEFAULT_CREW.bots
  const normalized = bots.map(normalizeBot)
  const ids = new Set(normalized.map((bot) => bot.id))
  if (ids.size !== normalized.length) {
    throw new Error('crew.bots 中存在重复 id')
  }
  const fallback = normalized[0].id
  const defaultBot = String(raw?.routing?.default || fallback).trim()
  if (!ids.has(defaultBot)) {
    throw new Error(`routing.default 指向不存在的 bot：${defaultBot}`)
  }
  const normModel = (value) => value && (value.provider || value.model)
    ? { provider: String(value.provider || ''), model: String(value.model || '') }
    : null
  // 统一实体：conversations（1 成员=私聊，2-6=群）；旧 rooms 自动迁移
  let conversations = Array.isArray(raw?.conversations)
    ? raw.conversations.map((conversation, i) => normalizeConversation(conversation, i, ids))
    : []
  if (conversations.length === 0 && Array.isArray(raw?.rooms) && raw.rooms.length > 0) {
    conversations = raw.rooms.map((room, i) => normalizeConversation(room, i, ids))
  }
  const routines = Array.isArray(raw?.routines) ? raw.routines.map((routine, i) => normalizeRoutine(routine, i, ids)) : []
  if (normalized.length + conversations.length > 50) {
    throw new Error('bots+conversations 总数已达上限 50')
  }
  return {
    routing: { default: defaultBot },
    bots: normalized,
    conversations,
    routines,
    defaultModel: normModel(raw?.defaultModel),
    utilityModel: normModel(raw?.utilityModel),
  }
}

export function serializeCrew(crew) {
  return `${JSON.stringify({
    routing: crew.routing,
    defaultModel: crew.defaultModel || null,
    utilityModel: crew.utilityModel || null,
    bots: crew.bots.map((bot) => ({ ...bot, model: bot.model || null })),
    conversations: crew.conversations || [],
    routines: (crew.routines || []).map((routine) => ({ ...routine, schedule: routine.schedule })),
  }, null, 2)}\n`
}

export async function loadOrCreateCrew(stateDir) {
  const path = join(stateDir, 'crew.json')
  try {
    return { path, crew: parseCrew(await readFile(path, 'utf8')), created: false }
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      if (error instanceof SyntaxError) throw new Error(`crew.json 解析失败：${error.message}`)
    }
    if (error?.code !== 'ENOENT') {
      throw new Error(`crew.json 读取失败：${error?.message || error}`)
    }
  }
  const crew = { routing: DEFAULT_CREW.routing, bots: DEFAULT_CREW.bots.map((bot, i) => normalizeBot(bot, i)) }
  await mkdir(stateDir, { recursive: true })
  await atomicWrite(path, serializeCrew(crew))
  return { path, crew, created: true }
}

export function routeJob(crew, job) {
  const wanted = String(job?.toBot || job?.bot || '').trim()
  if (wanted) {
    const hit = crew.bots.find((bot) => bot.id === wanted)
    if (hit) return hit
  }
  return crew.bots.find((bot) => bot.id === crew.routing.default) || crew.bots[0]
}

export async function atomicWrite(path, text) {
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, path)
}

export function botWorkspace(stateDir, bot) {
  // Grok Bot 语义：全队共享一台电脑；bot.workspace 仅作高级覆盖
  return bot.workspace || join(stateDir, 'workspace')
}

function slugId(name) {
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'bot'
  return `${base}-${randomUUID().slice(0, 6)}`
}

export function createBot(crew, input) {
  const draft = {
    id: String(input?.id || '').trim() || slugId(input?.name),
    name: String(input?.name || input?.id || '新专家').trim(),
    avatar: String(input?.avatar || '🤖').trim() || '🤖',
    title: String(input?.title || '').trim(),
    persona: String(input?.persona || '').trim(),
    workspace: String(input?.workspace || '').trim(),
    model: input?.model && (input.model.provider || input.model.model)
      ? { provider: String(input.model.provider || ''), model: String(input.model.model || '') }
      : null,
    pinned: input?.pinned === true,
    section: String(input?.section || '').trim(),
    hidden: input?.hidden === true,
  }
  if (crew.bots.some((bot) => bot.id === draft.id)) {
    throw new Error(`bot id 已存在：${draft.id}`)
  }
  if (crew.bots.length + (crew.conversations?.length ?? 0) >= 50) {
    throw new Error('bots+conversations 总数已达上限 50')
  }
  const bot = normalizeBot(draft, crew.bots.length)
  crew.bots.push(bot)
  return bot
}

const EDITABLE_FIELDS = ['name', 'avatar', 'title', 'persona', 'workspace', 'pinned', 'section', 'hidden', 'model']

export function updateBot(crew, botId, patch) {
  const bot = crew.bots.find((entry) => entry.id === botId)
  if (!bot) throw new Error(`bot 不存在：${botId}`)
  if (!patch || typeof patch !== 'object') throw new Error('patch 必须是对象')
  for (const key of Object.keys(patch)) {
    if (!EDITABLE_FIELDS.includes(key)) throw new Error(`不可编辑字段：${key}`)
  }
  Object.assign(bot, normalizeBot({ ...bot, ...patch }, 0))
  if (crew.routing.default === botId && bot.hidden === true) {
    // 默认收件人不允许隐藏：会吞掉无目标任务
    bot.hidden = false
  }
  return bot
}

export function removeBot(crew, botId) {
  const index = crew.bots.findIndex((entry) => entry.id === botId)
  if (index < 0) throw new Error(`bot 不存在：${botId}`)
  if (crew.bots.length <= 1) throw new Error('至少保留一个专家')
  crew.bots.splice(index, 1)
  if (crew.routing.default === botId) {
    crew.routing.default = crew.bots[0].id
  }
  // 从所有会话移除该成员；只剩 1 人的群聊保持为私聊语义
  for (const conversation of crew.conversations ?? []) {
    conversation.memberBotIds = conversation.memberBotIds.filter((memberId) => memberId !== botId)
  }
  crew.conversations = (crew.conversations ?? []).filter((conversation) => conversation.memberBotIds.length > 0)
  // 连带清理该 bot 的例行任务，避免悬空引用导致下次启动解析失败
  if (Array.isArray(crew.routines)) {
    crew.routines = crew.routines.filter((routine) => routine.botId !== botId)
  }
  return crew.bots
}

export function duplicateBot(crew, botId) {
  const source = crew.bots.find((entry) => entry.id === botId)
  if (!source) throw new Error(`bot 不存在：${botId}`)
  // 复制 profile/设置，不复制记忆与对话（记忆按 botId 隔离，天然不带走）
  return createBot(crew, {
    name: `${source.name} 副本`,
    avatar: source.avatar,
    title: source.title,
    persona: source.persona,
    workspace: source.workspace,
    model: source.model,
    pinned: false,
    section: source.section,
    hidden: false,
  })
}

export function createConversation(crew, input) {
  if (!Array.isArray(crew.conversations)) crew.conversations = []
  const ids = new Set(crew.bots.map((bot) => bot.id))
  const memberBotIds = Array.isArray(input?.memberBotIds) ? input.memberBotIds.map(String) : []
  const draft = {
    id: String(input?.id || '').trim() || (memberBotIds.length === 1 ? memberBotIds[0] : slugId(String(input?.name || 'conv'))),
    name: String(input?.name || '').trim(),
    memberBotIds,
  }
  if (crew.conversations.some((conversation) => conversation.id === draft.id)) {
    throw new Error(`conversation id 已存在：${draft.id}`)
  }
  const conversation = normalizeConversation(draft, crew.conversations.length, ids)
  crew.conversations.push(conversation)
  return conversation
}

export function renameConversation(crew, conversationId, name) {
  const conversation = crew.conversations?.find((entry) => entry.id === conversationId)
  if (!conversation) throw new Error(`conversation 不存在：${conversationId}`)
  conversation.name = String(name || '').trim()
  return conversation
}

export function addConversationMember(crew, conversationId, botId) {
  const conversation = crew.conversations?.find((entry) => entry.id === conversationId)
  if (!conversation) throw new Error(`conversation 不存在：${conversationId}`)
  if (!crew.bots.some((bot) => bot.id === botId)) throw new Error(`bot 不存在：${botId}`)
  if (conversation.memberBotIds.includes(botId)) throw new Error(`成员已在会话中：${botId}`)
  if (conversation.memberBotIds.length >= 6) throw new Error('会话成员已达上限 6')
  conversation.memberBotIds.push(botId)
  return conversation
}

export function removeConversationMember(crew, conversationId, botId) {
  const conversation = crew.conversations?.find((entry) => entry.id === conversationId)
  if (!conversation) throw new Error(`conversation 不存在：${conversationId}`)
  const index = conversation.memberBotIds.indexOf(botId)
  if (index < 0) throw new Error(`成员不在会话中：${botId}`)
  if (conversation.memberBotIds.length <= 1) throw new Error('会话至少保留一名成员')
  conversation.memberBotIds.splice(index, 1)
  return conversation
}

export function removeConversation(crew, conversationId) {
  const index = crew.conversations?.findIndex((entry) => entry.id === conversationId) ?? -1
  if (index < 0) throw new Error(`conversation 不存在：${conversationId}`)
  crew.conversations.splice(index, 1)
  return crew.conversations
}

export function upsertRoutine(crew, input, routineId) {
  if (!Array.isArray(crew.routines)) crew.routines = []
  const ids = new Set(crew.bots.map((bot) => bot.id))
  if (routineId) {
    const routine = crew.routines.find((entry) => entry.id === routineId)
    if (!routine) throw new Error(`routine 不存在：${routineId}`)
    Object.assign(routine, normalizeRoutine({ ...routine, ...(input ?? {}) }, 0, ids))
    return routine
  }
  const draft = { ...input, id: String(input?.id || '').trim() || slugId('routine') }
  if (crew.routines.some((routine) => routine.id === draft.id)) {
    throw new Error(`routine id 已存在：${draft.id}`)
  }
  const routine = normalizeRoutine(draft, crew.routines.length, ids)
  crew.routines.push(routine)
  return routine
}

export function removeRoutine(crew, routineId) {
  const index = crew.routines?.findIndex((entry) => entry.id === routineId) ?? -1
  if (index < 0) throw new Error(`routine 不存在：${routineId}`)
  crew.routines.splice(index, 1)
  return crew.routines
}
