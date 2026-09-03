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
    persona: String(raw.persona || '').trim(),
    workspace: String(raw.workspace || '').trim(),
    model,
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
  return { routing: { default: defaultBot }, bots: normalized }
}

export function serializeCrew(crew) {
  return `${JSON.stringify({
    routing: crew.routing,
    bots: crew.bots.map((bot) => ({ ...bot, model: bot.model || null })),
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
  return bot.workspace || join(stateDir, 'workspaces', bot.id)
}
