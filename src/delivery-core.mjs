/*
 * 交付链纯逻辑（可单测）：路径包含判定 + 会话路由分类。
 * index.mjs 的 deliver_file 工具与 reveal 路由共用，保证两处判定一致。
 */
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path'

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

/* ---------------- 快照落盘（fs 层，文件级可测） ---------------- */

const ARTIFACT_MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.bin': 'application/octet-stream',
}

/**
 * 创建成果快照：payload 固定 data/payload（与 meta.json 分离，原名可为 meta.json）；
 * size 以快照字节为准。extra（taskId/runId 等）并入 meta。
 * 前置条件：sourceReal 已通过 isInsideRoot 校验且为常规文件。
 */
export async function createArtifactSnapshot({ artifactsRoot, sourceReal, workspaceRoot, extra = {} }) {
  const { mkdir, writeFile, copyFile, readFile } = await import('node:fs/promises')
  const { createHash, randomUUID } = await import('node:crypto')
  const id = `art-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const dir = join(artifactsRoot, id)
  await mkdir(join(dir, 'data'), { recursive: true })
  const payloadPath = join(dir, 'data', 'payload')
  await copyFile(sourceReal, payloadPath)
  const buf = await readFile(payloadPath)
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const name = basename(sourceReal)
  const meta = {
    id,
    name,
    size: buf.length,
    mime: ARTIFACT_MIME[extname(name).toLowerCase()] || 'application/octet-stream',
    sha256,
    sourcePath: sourceReal,
    workspaceRoot,
    createdAt: Date.now(),
    ...extra,
  }
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 1))
  return { meta, payloadPath }
}

export function artifactMime(name) {
  return ARTIFACT_MIME[extname(String(name)).toLowerCase()] || 'application/octet-stream'
}
