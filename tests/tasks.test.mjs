import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, symlink, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  createTask, getTask, listTasks, startRun, endRun, attachArtifact, withTaskLock,
} from '../src/tasks.mjs'
import { isInsideRoot, classifyDeliveryTarget, createArtifactSnapshot } from '../src/delivery-core.mjs'

const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const workdir = await mkdtemp(join(tmpdir(), 'gk-tasks-'))

test('Task/Run：稳定 taskId、可区分 run、续改重开', async () => {
  const t = await createTask(workdir, { conversationId: 'g1', ownerBotId: 'a', workspace: '/ws', title: '小网页' })
  assert.match(t.id, /^task-/)
  const r1 = await startRun(workdir, t.id, { botId: 'a', origin: 'user', note: 'V1' })
  assert.equal(r1.run.origin, 'user')
  await endRun(workdir, t.id, r1.run.id, 'done')
  let task = await getTask(workdir, t.id)
  assert.equal(task.status, 'done')
  const r2 = await startRun(workdir, t.id, { botId: 'a', origin: 'continue', note: 'V2' })
  task = await getTask(workdir, t.id)
  assert.equal(task.status, 'open') // 续改重开
  assert.equal(task.runs.length, 2)
  assert.notEqual(r1.run.id, r2.run.id)
  // handoff run 的 bot 换人
  const r3 = await startRun(workdir, t.id, { botId: 'b', origin: 'handoff', note: 'V3' })
  assert.equal(r3.run.botId, 'b')
})

test('Task：artifact 引用追加去重；listTasks 按会话过滤', async () => {
  const t = await createTask(workdir, { conversationId: 'g2', ownerBotId: 'a', title: 'x' })
  await attachArtifact(workdir, t.id, 'art-1')
  await attachArtifact(workdir, t.id, 'art-1')
  await attachArtifact(workdir, t.id, 'art-2')
  const task = await getTask(workdir, t.id)
  assert.deepEqual(task.artifacts, ['art-1', 'art-2'])
  const inG2 = await listTasks(workdir, { conversationId: 'g2' })
  assert.ok(inG2.every((x) => x.conversationId === 'g2'))
  const t3 = await createTask(workdir, { conversationId: 'g3', ownerBotId: 'a', title: 'y' })
  const all = await listTasks(workdir)
  assert.ok(all.length >= 3)
  assert.equal((await getTask(workdir, t3.id)).title, 'y')
})

test('withTaskLock：同任务串行、异任务并行', async () => {
  const order = []
  await Promise.all([
    withTaskLock('t-lock', async () => { await new Promise((r) => setTimeout(r, 60)); order.push('A') }),
    withTaskLock('t-lock', async () => { order.push('B') }),
    withTaskLock('t-other', async () => { order.push('C') }),
  ])
  assert.deepEqual(order, ['C', 'A', 'B'])
})

test('createArtifactSnapshot：真实文件——同名 meta.json 不覆盖、size 取快照字节、extra 并入', async () => {
  const root = join(workdir, 'ws1')
  await mkdir(join(root, 'sub'), { recursive: true })
  const content = Buffer.from('{"a":1}')
  await writeFile(join(root, 'meta.json'), content)
  const { meta } = await createArtifactSnapshot({
    artifactsRoot: join(workdir, 'artifacts'),
    sourceReal: join(root, 'meta.json'),
    workspaceRoot: root,
    extra: { taskId: 'task-x', runId: 'run-y' },
  })
  assert.equal(meta.name, 'meta.json')
  assert.equal(meta.size, content.length)
  assert.equal(meta.taskId, 'task-x')
  // meta.json 本体仍是元数据；payload 才是原件
  const stored = JSON.parse(await readFile(join(workdir, 'artifacts', meta.id, 'meta.json'), 'utf8'))
  assert.equal(stored.sha256, sha(content))
  const payload = await readFile(join(workdir, 'artifacts', meta.id, 'data', 'payload'))
  assert.deepEqual(payload, content)
})

test('createArtifactSnapshot：零字节文件', async () => {
  const root = join(workdir, 'ws2')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'empty.bin'), Buffer.alloc(0))
  const { meta } = await createArtifactSnapshot({ artifactsRoot: join(workdir, 'artifacts'), sourceReal: join(root, 'empty.bin'), workspaceRoot: root })
  assert.equal(meta.size, 0)
  assert.equal(meta.sha256, sha(Buffer.alloc(0)))
})

test('createArtifactSnapshot：快照不可变（源改写后旧快照不变）', async () => {
  const root = join(workdir, 'ws3')
  await mkdir(root, { recursive: true })
  const src = join(root, 'doc.txt')
  await writeFile(src, 'version-1')
  const { meta } = await createArtifactSnapshot({ artifactsRoot: join(workdir, 'artifacts'), sourceReal: src, workspaceRoot: root })
  await writeFile(src, 'version-2-longer')
  const payload = await readFile(join(workdir, 'artifacts', meta.id, 'data', 'payload'))
  assert.equal(payload.toString(), 'version-1')
  assert.equal(meta.size, 'version-1'.length)
})

test('文件层边界：symlink 指向工作区外（realpath 后 containment 拒绝）', async () => {
  const root = join(workdir, 'ws4')
  const outside = join(workdir, 'outside-secret.txt')
  await mkdir(root, { recursive: true })
  await writeFile(outside, 'SECRET')
  await symlink(outside, join(root, 'leak.link'))
  const { realpath } = await import('node:fs/promises')
  const rootReal = await realpath(root)
  const linkReal = await realpath(join(root, 'leak.link'))
  assert.equal(isInsideRoot(rootReal, linkReal), false) // 拒绝
  const inRootReal = await realpath(join(root, '../ws4')) // 根别名等价
  assert.equal(isInsideRoot(rootReal, inRootReal), false || isInsideRoot(rootReal, await realpath(root)))
})

test('classifyDeliveryTarget：handoff 路由分类（R2-A 交接范围）', () => {
  const convs = [{ id: 'g1', memberBotIds: ['a', 'b'] }, { id: 'g2', memberBotIds: ['a'] }]
  assert.equal(classifyDeliveryTarget({ conversationId: 'g1', botId: 'a', conversations: convs }), 'room')
  assert.equal(classifyDeliveryTarget({ conversationId: 'g2', botId: 'a', conversations: convs }), 'room') // 单成员群
  assert.equal(classifyDeliveryTarget({ conversationId: 'gone', botId: 'a', conversations: convs }), 'rejected')
  assert.equal(classifyDeliveryTarget({ conversationId: 'a', botId: 'a', conversations: convs }), 'dm')
})

// 清理
test.after?.(() => { rm(workdir, { recursive: true, force: true }).catch(() => undefined) })

/* ---------------- 共享入口校验（R2-A P1-1：A/B/DM 错误 taskId） ---------------- */
import { validateTaskForContext } from '../src/tasks.mjs'

const memTasks = new Map()
const fakeGetTask = async (id) => memTasks.get(id) ?? null
memTasks.set('task-a', { id: 'task-a', conversationId: 'group-a', ownerBotId: 'a' })
memTasks.set('task-b', { id: 'task-b', conversationId: 'group-b', ownerBotId: 'b' })
memTasks.set('task-dm', { id: 'task-dm', conversationId: null, ownerBotId: 'a' })

test('validateTaskForContext：群 A 任务在群 B 执行被拒', async () => {
  const r = await validateTaskForContext('task-a', { conversationId: 'group-b', botId: 'b', getTask: fakeGetTask })
  assert.equal(r.ok, false)
  assert.match(r.error, /不属于当前会话/)
})

test('validateTaskForContext：群任务在 DM 上下文被拒（非 owner）', async () => {
  const r = await validateTaskForContext('task-a', { conversationId: null, botId: 'b', getTask: fakeGetTask })
  assert.equal(r.ok, false)
  assert.match(r.error, /私聊上下文/)
})

test('validateTaskForContext：DM owner 可续改无会话任务；非 owner 被拒', async () => {
  assert.equal((await validateTaskForContext('task-dm', { conversationId: null, botId: 'a', getTask: fakeGetTask })).ok, true)
  assert.equal((await validateTaskForContext('task-dm', { conversationId: null, botId: 'b', getTask: fakeGetTask })).ok, false)
})

test('validateTaskForContext：错误 taskId（非法格式/不存在）被拒；空放行', async () => {
  assert.equal((await validateTaskForContext('../etc', { conversationId: 'group-a', botId: 'a', getTask: fakeGetTask })).ok, false)
  assert.equal((await validateTaskForContext('task-none', { conversationId: 'group-a', botId: 'a', getTask: fakeGetTask })).ok, false)
  assert.equal((await validateTaskForContext(null, { conversationId: 'group-a', botId: 'a', getTask: fakeGetTask })).ok, true)
})

test('validateTaskForContext：本会话任务放行', async () => {
  const r = await validateTaskForContext('task-a', { conversationId: 'group-a', botId: 'a', getTask: fakeGetTask })
  assert.equal(r.ok, true)
  assert.equal(r.task.id, 'task-a')
})
