/*
 * 交付链纯逻辑（可单测）：路径包含判定 + 会话路由分类。
 * index.mjs 的 deliver_file 工具与 reveal 路由共用，保证两处判定一致。
 */
import { isAbsolute, relative, sep } from 'node:path'

/**
 * targetReal 是否严格位于 rootReal 内（两者须为真实路径）。
 * 注意：文件名以 .. 开头（如 `..notes.txt`）是合法相对段，不得误拒；
 * 逃逸判定是 rel === '..' 或以 '..' + 分隔符 开头，或 rel 为绝对路径。
 */
export function isInsideRoot(rootReal, targetReal) {
  if (!rootReal || !targetReal) return false
  const rel = relative(rootReal, targetReal)
  if (rel === '') return false // 目标即根本身（目录），不可作为交付文件
  if (rel === '..' || rel.startsWith('..' + sep)) return false
  return !isAbsolute(rel)
}

/**
 * 交付目标分类：
 * - 'dm'：无会话上下文，或统一实体（conversationId === botId）
 * - 'room'：crew 中存在的会话实体（含单成员群——v3 会话身份固定）
 * - 'rejected'：conversationId 非本 bot DM 但实体不存在（群已被删除）→ 拒绝，绝不落私聊
 */
export function classifyDeliveryTarget({ conversationId, botId, conversations }) {
  if (!conversationId || conversationId === botId) return 'dm'
  const conv = (conversations ?? []).find((c) => c.id === conversationId)
  return conv ? 'room' : 'rejected'
}
