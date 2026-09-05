import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * todi-hub 兼容文件协议：
 *   <inbox>/queue.jsonl            每行一个 {jobId, text, dir, images, toBot?}
 *   <inbox>/<jobId>/job.json       任务详情（可选，queue 行已含关键信息）
 *   <inbox>/<jobId>/prompt.md      完整提示词（优先于 job.text）
 *   <inbox>/<jobId>/image_*.png    附件
 *   <inbox>/<jobId>/reply.md       插件写入的回复（非空即完成）
 *   <inbox>/<jobId>/status.json    插件写入的状态 {status, botId, ...}
 */

export async function ensureInbox(inboxRoot) {
  await mkdir(inboxRoot, { recursive: true })
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

async function readTextIfPresent(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function scanInbox(inboxRoot, { limit = 50 } = {}) {
  const queueText = await readTextIfPresent(join(inboxRoot, 'queue.jsonl'))
  const jobs = []
  for (const line of queueText.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue
    }
    const jobId = String(entry.jobId || entry.id || '').trim()
    if (!jobId) continue
    const dir = String(entry.dir || join(inboxRoot, jobId))
    const statusPath = join(dir, 'status.json')
    const status = await readJsonIfPresent(statusPath)
    if (status && status.status !== 'queued') continue
    if (await exists(join(dir, 'reply.md'))) continue
    const promptMd = await readTextIfPresent(join(dir, 'prompt.md'))
    const jobJson = await readJsonIfPresent(join(dir, 'job.json'))
    jobs.push({
      jobId,
      dir,
      toBot: String(entry.toBot || jobJson?.toBot || '').trim(),
      text: promptMd.trim() || String(entry.text || jobJson?.text || '').trim(),
      images: Array.isArray(entry.images) ? entry.images.map(String) : [],
      createdAt: Number(entry.createdAt) || null,
      ...(entry.fromBotId || jobJson?.fromBotId ? { fromBotId: String(entry.fromBotId || jobJson.fromBotId) } : {}),
      ...(entry.conversationId || jobJson?.conversationId ? { conversationId: String(entry.conversationId || jobJson.conversationId) } : {}),
    })
    if (jobs.length >= limit) break
  }
  return jobs
}

export async function claimJob(job, botId) {
  await mkdir(job.dir, { recursive: true })
  await writeStatus(job.dir, {
    status: 'claimed',
    botId,
    jobId: job.jobId,
    startedAt: Date.now(),
  })
}

async function readStatusIfPresent(dir) {
  try {
    return JSON.parse(await readFile(join(dir, 'status.json'), 'utf8'))
  } catch {
    return null
  }
}

export async function completeJob(job, botId, replyText) {
  const replyPath = join(job.dir, 'reply.md')
  await atomicWriteFile(replyPath, `${replyText.trim()}\n`)
  const claimed = await readStatusIfPresent(job.dir)
  await writeStatus(job.dir, {
    status: 'replied',
    botId,
    jobId: job.jobId,
    startedAt: claimed?.startedAt ?? null,
    endedAt: Date.now(),
    replyBytes: Buffer.byteLength(replyText, 'utf8'),
  })
}

export async function failJob(job, botId, errorText) {
  const replyPath = join(job.dir, 'reply.md')
  await atomicWriteFile(replyPath, `[任务失败] ${errorText}\n`)
  const claimed = await readStatusIfPresent(job.dir)
  await writeStatus(job.dir, {
    status: 'failed',
    botId,
    jobId: job.jobId,
    startedAt: claimed?.startedAt ?? null,
    endedAt: Date.now(),
    error: String(errorText).slice(0, 2000),
  })
}

export async function cancelJob(job, botId, reasonText) {
  const claimed = await readStatusIfPresent(job.dir)
  await writeStatus(job.dir, {
    status: 'cancelled',
    botId,
    jobId: job.jobId,
    startedAt: claimed?.startedAt ?? null,
    endedAt: Date.now(),
    reason: String(reasonText || 'cancelled').slice(0, 500),
  })
}

export async function writeStatus(dir, payload) {
  await atomicWriteFile(join(dir, 'status.json'), `${JSON.stringify(payload, null, 2)}\n`)
}

export async function atomicWriteFile(path, text) {
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, path)
}

export async function enqueueJob(inboxRoot, { jobId, toBot, text, images = [], fromBotId, conversationId }) {
  const id = String(jobId || `job_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`)
  const dir = join(inboxRoot, id)
  await mkdir(dir, { recursive: true })
  const payload = {
    jobId: id, id, text, dir, toBot: String(toBot || ''), images, createdAt: Date.now(),
    ...(fromBotId ? { fromBotId: String(fromBotId) } : {}),
    ...(conversationId ? { conversationId: String(conversationId) } : {}),
  }
  await atomicWriteFile(join(dir, 'job.json'), `${JSON.stringify(payload, null, 2)}\n`)
  await atomicWriteFile(join(dir, 'prompt.md'), `${String(text || '').trim()}\n`)
  const queueLine = `${JSON.stringify(payload)}\n`
  const queuePath = join(inboxRoot, 'queue.jsonl')
  await appendLine(queuePath, queueLine)
  return payload
}

async function appendLine(path, line) {
  const { appendFile } = await import('node:fs/promises')
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch {
    text = ''
  }
  if (!text.endsWith('\n') && text.length > 0) {
    await appendFile(path, '\n')
  }
  await appendFile(path, line)
}
