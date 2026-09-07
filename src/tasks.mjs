/*
 * R2-A：最小持续任务模型（Task/Run）。
 * Task = 一件持续工作（稳定 id、来源会话、负责人、workspace、成果版本引用）
 * Run  = 该任务的一次执行（可区分：user 首做 / continue 续改 / handoff 接力）
 * 存储：stateDir/tasks/<taskId>.json（原子写）；同 taskId 的 run 串行（最小排队）。
 * 纯逻辑与存储，可单测；不新建执行引擎——执行仍走既有 chatTurn/inbox。
 */
import { mkdir, readFile, writeFile, readdir, rename } from 'node:fs/promises'
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
  await atomicWriteJson(join(tasksDir(stateDir), `${task.id}.json`), task)
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

async function atomicWriteJson(path, data) {
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 1))
  await rename(tmp, path)
}

async function saveTask(stateDir, task) {
  task.updatedAt = Date.now()
  await atomicWriteJson(join(tasksDir(stateDir), `${task.id}.json`), task)
  return task
}

const taskMutations = new Map()

/** 同一 task 的存储变更串行（read-modify-write 不互踩）；与运行锁（withTaskLock）职责分离 */
async function withTaskMutation(taskId, fn) {
  const prev = taskMutations.get(taskId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  taskMutations.set(taskId, next.catch(() => undefined))
  return next
}

export async function startRun(stateDir, taskId, { botId, origin, note, executor = null }) {
  return withTaskMutation(taskId, async () => {
  const task = await getTask(stateDir, taskId)
  if (!task) return null
  const run = {
    id: newId('run'),
    botId: botId || null,
    origin: ['user', 'continue', 'handoff'].includes(origin) ? origin : 'user',
    note: String(note || '').slice(0, 200),
    ...(executor && executor.kind ? { executor } : {}),
    startedAt: Date.now(),
    endedAt: null,
    status: 'running',
  }
  task.runs.push(run)
  if (task.status === 'done') task.status = 'open' // 续改重开
  await saveTask(stateDir, task)
  return { task, run }
  })
}

export async function endRun(stateDir, taskId, runId, status = 'done') {
  return withTaskMutation(taskId, async () => {
  const task = await getTask(stateDir, taskId)
  if (!task) return null
  const run = task.runs.find((r) => r.id === runId)
  if (!run) return null
  run.endedAt = Date.now()
  run.status = ['done', 'failed', 'cancelled'].includes(status) ? status : 'done'
  if (task.runs.every((r) => r.status !== 'running')) task.status = run.status === 'done' ? 'done' : 'open'
  await saveTask(stateDir, task)
  return { task, run }
  })
}

export async function attachArtifact(stateDir, taskId, artifactId) {
  return withTaskMutation(taskId, async () => {
  const task = await getTask(stateDir, taskId)
  if (!task) return null
  if (!task.artifacts.includes(artifactId)) task.artifacts.push(artifactId)
  await saveTask(stateDir, task)
  return task
  })
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


/**
 * 执行前任务校验（所有入口共用：续改/交付/后台接力）。
 * 规则：taskId 合法且任务存在；归属=任务会话===当前会话；
 * 无会话上下文（DM）时仅接受无会话任务或 owner 即该 bot 的任务。
 * getTask 注入以便测试；conversations 为 crew 会话数组（校验 DM 规范化身份）。
 */
export function validateTaskForContext(taskId, { conversationId, botId, getTask: loadTask }) {
  return (async () => {
    if (!taskId) return { ok: true, task: null }
    if (!/^[a-z0-9-]+$/i.test(String(taskId))) return { ok: false, error: 'taskId 非法' }
    const task = await loadTask(String(taskId)).catch(() => null)
    if (!task) return { ok: false, error: `任务不存在：${taskId}` }
    if (conversationId) {
      if (task.conversationId !== conversationId) return { ok: false, error: `任务 ${taskId} 不属于当前会话（属 ${task.conversationId || 'DM/无会话'}）` }
    } else {
      // 无会话上下文（DM）：仅接受无会话任务且 owner 即该 bot（他人 DM 任务不放行）
      const dmOwned = !task.conversationId && task.ownerBotId === botId
      if (!dmOwned) return { ok: false, error: `任务 ${taskId} 不能在当前私聊上下文执行（属 ${task.conversationId || '其他成员的 DM'}）` }
    }
    return { ok: true, task }
  })()
}


/**
 * 取消小批统一终态分类（run/job/奖励/通知共用；不靠 error 文本猜测意图）。
 * cancelledIntent：该 run 是否登记过取消意图（cancelledRunIds）。
 * 返回 { status, notifyKind }：status ∈ done|failed|cancelled；notifyKind ∈ none|cancelled|failed。
 */
export function classifyExecutionOutcome({ cancelledIntent, error, text }) {
  if (cancelledIntent) return { status: 'cancelled', notifyKind: 'cancelled' }
  if (error) return { status: 'failed', notifyKind: 'failed' }
  if (!String(text || '').trim()) return { status: 'failed', notifyKind: 'failed' }
  return { status: 'done', notifyKind: 'none' }
}


/**
 * 编排取消收尾统一判定（chatTurn / runJobBody 共用；可测）。
 * entryRunId：入口带来的 run（续改/handoff）；liveRunId：回合内 task_begin 新建 run
 * （从 activeTurnCtx 读取）。两者取一作为"本回合实际 run"。
 * 返回 { actualRunId, cancelled, finalStatus }——供存储、返回值、群/DM 通知、
 * job 分类与奖励统一使用；普通异常 finalStatus='failed' 不变。
 */
export function resolveTurnFinalOutcome({ entryRunId, liveRunId, entryTaskId, liveTaskId, cancelledSet, error, text }) {
  const actualRunId = entryRunId ?? liveRunId ?? null
  const actualTaskId = entryRunId ? entryTaskId : (liveTaskId ?? null)
  const cancelled = actualRunId ? cancelledSet.has(actualRunId) : false
  if (cancelled) return { actualRunId, actualTaskId, cancelled: true, finalStatus: 'cancelled' }
  const cls = classifyExecutionOutcome({ cancelledIntent: false, error, text })
  return { actualRunId, actualTaskId, cancelled: false, finalStatus: cls.status }
}
