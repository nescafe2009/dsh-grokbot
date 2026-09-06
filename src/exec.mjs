/*
 * R2-A：统一执行互斥（聊天 / inbox 后台任务 / 接力共用）。
 * 锁序固定：任务锁（外）→ bot 锁（中）→ workspace 写队列（内），全入口一致，无交叉序。
 * - 同 task 串行（跨 bot 的接力也排队）
 * - 同 bot 串行（聊天与后台任务不并发覆盖回合上下文）
 * - 同 workspace 写排队（不同 workspace 并行）
 * 纯逻辑可测：用 active 计数器验证各维度最大并发为 1。
 */
const taskLocks = new Map()
const botLocks = new Map()
const wsLocks = new Map()

function chain(map, key, fn) {
  const prev = map.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  map.set(key, next.catch(() => undefined))
  return next
}

/** 任务锁（可单独用于不经过 bot/workspace 的存储级互斥） */
export function withTaskLock(taskId, fn) {
  if (!taskId) return fn()
  return chain(taskLocks, taskId, fn)
}

/**
 * 统一执行入口：chatTurn 与 runInboxJob 都必须经由它进入执行段。
 * options.workspace 为本次执行根（真实路径）；为空则跳过 workspace 队列。
 */
export function runExclusively({ taskId = null, botId, workspace = null }, fn) {
  return withTaskLock(taskId, () => chain(botLocks, botId, () => {
    if (!workspace) return fn()
    return chain(wsLocks, workspace, fn)
  }))
}

/** 测试辅助：当前各队列深度（防泄漏观测） */
export function lockDepth() {
  return { task: taskLocks.size, bot: botLocks.size, ws: wsLocks.size }
}
