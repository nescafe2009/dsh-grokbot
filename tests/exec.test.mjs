import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { runExclusively, withTaskLock } from '../src/exec.mjs'
import { createTask } from '../src/tasks.mjs'
import { createArtifactSnapshot, isInsideRoot } from '../src/delivery-core.mjs'

// —— R2-A 五轮 P1 回归：入口级互斥 + 交付先定任务根 ——

function makeCounter() {
  const c = { active: 0, max: 0, order: [] }
  c.enter = (tag) => { c.active += 1; c.max = Math.max(c.max, c.active); c.order.push(tag) }
  c.exit = () => { c.active -= 1 }
  return c
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('runExclusively：同 (task,bot) 聊天+inbox 并发 → 最大执行数 1（入口级阻塞）', async () => {
  const c = makeCounter()
  await Promise.all([
    // 模拟 chatTurn：先进入并驻留（长回合）
    runExclusively({ taskId: 't1', botId: 'b1', workspace: '/ws' }, async () => {
      c.enter('chat'); await sleep(60); c.exit()
    }),
    // 模拟 inbox job：同 task 同 bot 排队等待
    runExclusively({ taskId: 't1', botId: 'b1', workspace: '/ws' }, async () => {
      c.enter('job'); await sleep(10); c.exit()
    }),
  ])
  assert.equal(c.max, 1)
})

test('runExclusively：同 task 跨 bot（接力）→ 最大 1；不同 task 不同 bot 并行', async () => {
  const c = makeCounter()
  await Promise.all([
    runExclusively({ taskId: 'tt', botId: 'a', workspace: '/w1' }, async () => { c.enter('a'); await sleep(50); c.exit() }),
    runExclusively({ taskId: 'tt', botId: 'b', workspace: '/w2' }, async () => { c.enter('b'); await sleep(10); c.exit() }),
    runExclusively({ taskId: 'other', botId: 'c', workspace: '/w3' }, async () => { c.enter('c'); await sleep(10); c.exit() }),
  ])
  assert.equal(c.max, 2) // c 与 (a,b) 并行；a/b 因同 task 互斥
})

test('runExclusively：同 workspace 不同 task 不同 bot → 写排队（最大 1）', async () => {
  const c = makeCounter()
  await Promise.all([
    runExclusively({ taskId: 'x1', botId: 'b1', workspace: '/shared-ws' }, async () => { c.enter(1); await sleep(50); c.exit() }),
    runExclusively({ taskId: 'x2', botId: 'b2', workspace: '/shared-ws' }, async () => { c.enter(2); await sleep(10); c.exit() }),
  ])
  assert.equal(c.max, 1, '同 workspace 并发写应排队')
})

test('交付顺序回归：显式任务的 workspace 决定源解析根（同名不同内容）', async () => {
  const workdir = await mkdtemp(join(tmpdir(), 'gk-exec-'))
  // 默认目录与任务目录各放同名 a.txt，内容不同
  const defaultWs = join(workdir, 'default-ws')
  const taskWs = join(workdir, 'task-ws')
  await mkdir(defaultWs, { recursive: true })
  await mkdir(taskWs, { recursive: true })
  await writeFile(join(defaultWs, 'a.txt'), 'WRONG DEFAULT')
  await writeFile(join(taskWs, 'a.txt'), 'CORRECT TASK')
  const task = await createTask(workdir, { conversationId: 'g1', ownerBotId: 'b1', workspace: taskWs, title: 'x' })
  // 模拟修复后的顺序：先取任务 workspace，再 resolve+快照
  const rootRaw = task.workspace
  const { realpath, stat } = await import('node:fs/promises')
  const rootReal = await realpath(rootRaw)
  const real = await realpath(join(rootReal, 'a.txt'))
  assert.ok(isInsideRoot(rootReal, real))
  assert.ok((await stat(real)).isFile())
  const { meta } = await createArtifactSnapshot({ artifactsRoot: join(workdir, 'artifacts'), sourceReal: real, workspaceRoot: rootReal, extra: { taskId: task.id } })
  const payload = await readFile(join(workdir, 'artifacts', meta.id, 'data', 'payload'))
  assert.equal(payload.toString(), 'CORRECT TASK', '快照必须来自任务工作区，而非默认目录')
  assert.equal(meta.taskId, task.id)
})

test('交付顺序回归：文件仅存在于任务目录时可达（旧顺序会误报不存在）', async () => {
  const workdir = await mkdtemp(join(tmpdir(), 'gk-exec2-'))
  const defaultWs = join(workdir, 'default-ws')
  const taskWs = join(workdir, 'task-ws')
  await mkdir(defaultWs, { recursive: true })
  await mkdir(taskWs, { recursive: true })
  await writeFile(join(taskWs, 'only-in-task.txt'), 'TASK ONLY')
  const task = await createTask(workdir, { conversationId: null, ownerBotId: 'b1', workspace: taskWs, title: 'dm' })
  const { realpath } = await import('node:fs/promises')
  const rootReal = await realpath(task.workspace)
  const real = await realpath(join(rootReal, 'only-in-task.txt'))
  assert.ok(isInsideRoot(rootReal, real), '任务根下的文件应可达')
})

test('快照 SHA 与 meta/字节一致（执行根正确性连带）', async () => {
  const workdir = await mkdtemp(join(tmpdir(), 'gk-exec3-'))
  await mkdir(workdir, { recursive: true })
  const content = Buffer.from('sha-check-内容')
  await writeFile(join(workdir, 'f.bin'), content)
  const { meta } = await createArtifactSnapshot({ artifactsRoot: join(workdir, 'arts'), sourceReal: join(workdir, 'f.bin'), workspaceRoot: workdir })
  assert.equal(meta.sha256, createHash('sha256').update(content).digest('hex'))
})

/* ---------------- 取消统一分类回归（abort 正常返回 / abort reject / 普通异常） ---------------- */
import { classifyExecutionOutcome } from '../src/tasks.mjs'

test('分类：取消意图优先——即使 whenIdle 抛错/正常返回文本', () => {
  assert.deepEqual(classifyExecutionOutcome({ cancelledIntent: true, error: null, text: '部分文本' }), { status: 'cancelled', notifyKind: 'cancelled' })
  assert.deepEqual(classifyExecutionOutcome({ cancelledIntent: true, error: new Error('agent aborted'), text: null }), { status: 'cancelled', notifyKind: 'cancelled' })
})

test('分类：无意图时普通错误=failed（含 error 文本带 cancel 字样的 provider 错误）', () => {
  const r = classifyExecutionOutcome({ cancelledIntent: false, error: 'provider cannot cancel request', text: 'x' })
  assert.equal(r.status, 'failed')
  assert.equal(r.notifyKind, 'failed')
})

test('分类：无意图无错误有文本=done；无文本=failed', () => {
  assert.deepEqual(classifyExecutionOutcome({ cancelledIntent: false, error: null, text: 'ok' }), { status: 'done', notifyKind: 'none' })
  assert.deepEqual(classifyExecutionOutcome({ cancelledIntent: false, error: null, text: '  ' }), { status: 'failed', notifyKind: 'failed' })
})
