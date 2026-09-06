/*
 * R2-A：最小持续任务模型（Task/Run）。
 * Task = 一件持续工作（稳定 id、来源会话、负责人、workspace、成果版本引用）
 * Run  = 该任务的一次执行（可区分：user 首做 / continue 续改 / handoff 接力）
 * 存储：stateDir/tasks/<taskId>.json（原子写）；同 taskId 的 run 串行（最小排队）。
 * 纯逻辑与存储，可单测；不新建执行引擎——执行仍走既有 chatTurn/inbox。
 */
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`

export function tasksDir(stateDir) {
  return join(stateDir, 'tasks')
}

export async function ensureTasks(stateDir) {
  await mkdir(tasksDir(stateDir), { recursive: true })
}

export async function createTask(stateDir, { conversationId, ownerBotId, workspace, title }) {
  const task = {
    id: newId('task'),
    title: String(title || '').slice(0, 120) || '未命名任务',
    conversationId: conversationId || null,
    ownerBotId: ownerBotId || null,
    workspace: workspace || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'open',
    runs: [],
    artifacts: [],
  }
  await ensureTasks(stateDir)
  await writeFile(join(tasksDir(stateDir), `${task.id}.json`), JSON.stringify(task, null, 1))
  return task
}

export async function getTask(stateDir, taskId) {
  if (!taskId || !/^[a-z0-9-]+$/i.test(taskId)) return null
  try {
    return JSON.parse(await readFile(join(tasksDir(stateDir), `${taskId}.json`), 'utf8'))
  } catch {
    return null
  }
}

export async function listTasks(stateDir, { conversationId } = {}) {
  let names
  try {
    names = await readdir(tasksDir(stateDir))
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const task = JSON.parse(await readFile(join(tasksDir(stateDir), name), 'utf8'))
      if (!conversationId || task.conversationId === conversationId) out.push(task)
    } catch { /* 跳过坏文件 */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

async function saveTask(stateDir, task) {
  task.updatedAt = Date.now()
  await writeFile(join(tasksDir(stateDir), `${task.id}.json`), JSON.stringify(task, null, 1))
  return task
}

export async function startRun(stateDir, taskId, { botId, origin, note }) {
  const task = await getTask(stateDir, taskId)
  if (!task) return null
  const run = {
    id: newId('run'),
    botId: botId || null,
    origin: ['user', 'continue', 'handoff'].includes(origin) ? origin : 'user',
    note: String(note || '').slice(0, 200),
    startedAt: Date.now(),
    endedAt: null,
    status: 'running',
  }
  task.runs.push(run)
  if (task.status === 'done') task.status = 'open' // 续改重开
  await saveTask(stateDir, task)
  return { task, run }
}

export async function endRun(stateDir, taskId, runId, status = 'done') {
  const task = await getTask(stateDir, taskId)
  if (!task) return null
  const run = task.runs.find((r) => r.id === runId)
  if (!run) return null
  run.endedAt = Date.now()
  run.status = ['done', 'failed', 'cancelled'].includes(status) ? status : 'done'
  if (status === 'done' && task.runs.every((r) => r.status !== 'running')) task.status = 'done'
  await saveTask(stateDir, task)
  return { task, run }
}

export async function attachArtifact(stateDir, taskId, artifactId) {
  const task = await getTask(stateDir, taskId)
  if (!task) return null
  if (!task.artifacts.includes(artifactId)) task.artifacts.push(artifactId)
  await saveTask(stateDir, task)
  return task
}

/** 最近交付（供续改/交接注入版本引用） */
export function latestArtifacts(task, limit = 3) {
  return (task?.artifacts ?? []).slice(-limit)
}

/* ---------------- 同任务串行（最小排队） ---------------- */

const taskQueues = new Map()

/**
 * 同 taskId 的执行段串行；不同 task 并行。
 * 运行中的后续排队者在前一个 settle 后依次进入（不丢）。
 */
export async function withTaskLock(taskId, fn) {
  if (!taskId) return fn()
  const prev = taskQueues.get(taskId) ?? Promise.resolve()
  let release
  const gate = new Promise((r) => { release = r })
  taskQueues.set(taskId, prev.then(() => gate))
  await prev.catch(() => undefined)
  try {
    return await fn()
  } finally {
    release()
  }
}
