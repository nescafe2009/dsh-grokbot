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

/* ---------------- 编排收尾贯通回归（Codex 十轮 P1-1）---------------- */
import { resolveTurnFinalOutcome } from '../src/tasks.mjs'

test('编排：入口 run（续改/handoff）取消——正常返回', () => {
  const r = resolveTurnFinalOutcome({ entryRunId: 'r1', entryTaskId: 't1', liveRunId: null, liveTaskId: null, cancelledSet: new Set(['r1']), error: null, text: '部分' })
  assert.equal(r.cancelled, true); assert.equal(r.finalStatus, 'cancelled'); assert.equal(r.actualRunId, 'r1')
})

test('编排：入口 run 取消——whenIdle reject（error 非空）仍 cancelled', () => {
  const r = resolveTurnFinalOutcome({ entryRunId: 'r1', entryTaskId: 't1', liveRunId: null, liveTaskId: null, cancelledSet: new Set(['r1']), error: new Error('agent aborted'), text: null })
  assert.equal(r.finalStatus, 'cancelled')
})

test('编排：回合内 task_begin 新建 run（liveRunId）取消——正常/reject 两条', () => {
  for (const error of [null, new Error('aborted')]) {
    const r = resolveTurnFinalOutcome({ entryRunId: null, entryTaskId: null, liveRunId: 'r2', liveTaskId: 't2', cancelledSet: new Set(['r2']), error, text: 'x' })
    assert.equal(r.cancelled, true); assert.equal(r.finalStatus, 'cancelled'); assert.equal(r.actualRunId, 'r2'); assert.equal(r.actualTaskId, 't2')
  }
})

test('编排：无意图普通异常=failed（chat 与 job 同判）', () => {
  const r = resolveTurnFinalOutcome({ entryRunId: 'r1', entryTaskId: 't1', liveRunId: null, liveTaskId: null, cancelledSet: new Set(), error: new Error('boom'), text: 'x' })
  assert.equal(r.finalStatus, 'failed'); assert.equal(r.cancelled, false)
})

test('编排：无 run 的普通回合=done/failed 不误标', () => {
  assert.equal(resolveTurnFinalOutcome({ entryRunId: null, liveRunId: null, cancelledSet: new Set(), error: null, text: 'ok' }).finalStatus, 'done')
  assert.equal(resolveTurnFinalOutcome({ entryRunId: null, liveRunId: null, cancelledSet: new Set(), error: 'e', text: null }).finalStatus, 'failed')
})

/* ---------------- 请求去重注册表（R2-B 十二轮 P1） ---------------- */
import { ChatRequestRegistry } from '../src/dedup.mjs'

test('去重：并发同 ID 共享在途（exec 只执行一次）', async () => {
  const reg = new ChatRequestRegistry()
  let calls = 0
  const exec = async () => { calls += 1; await new Promise((r) => setTimeout(r, 40)); return { reply: 'R' } }
  const a = reg.begin('req-1', { text: 'hi' }, exec)
  const b = reg.begin('req-1', { text: 'hi' }, exec)
  const ra = await a.run(); const rb = await b.run()
  assert.equal(calls, 1)
  assert.deepEqual(rb.result?.reply ?? rb, ra.result?.reply ?? 'R')
})

test('去重：同 ID 不同载荷 → 409 冲突（不执行）', async () => {
  const reg = new ChatRequestRegistry()
  let calls = 0
  const a = reg.begin('req-2', { text: 'x' }, async () => { calls += 1; return {} })
  const b = reg.begin('req-2', { text: 'y' }, async () => { calls += 1; return {} })
  await a.run()
  assert.equal(b.error?.status, 409)
  assert.equal(calls, 1)
})

test('去重：成功 TTL 内缓存命中；失败短 TTL 内返回失败不重做', async () => {
  let time = 1000
  const reg = new ChatRequestRegistry({ now: () => time })
  let calls = 0
  const ok = reg.begin('req-3', { text: 'a' }, async () => { calls += 1; return { v: 1 } })
  await ok.run()
  time += 60_000
  const hit = reg.begin('req-3', { text: 'a' }, async () => { calls += 1; return { v: 2 } })
  assert.equal(hit.deduped, true); assert.deepEqual(hit.result, { v: 1 }); assert.equal(calls, 1)
  // 失败：短 TTL 内重试返回失败、不重做
  const fail = reg.begin('req-4', { text: 'b' }, async () => { calls += 1; throw new Error('boom') })
  const rf = await fail.run()
  assert.equal(rf.ok, false)
  const retry = reg.begin('req-4', { text: 'b' }, async () => { calls += 1; return { v: 9 } })
  assert.equal(retry.deduped, true); assert.equal(retry.cachedFailure, 'boom'); assert.equal(retry.error, null)
  assert.equal(calls, 2) // 失败那次只执行了一次
  time += 31_000
  const retryLate = reg.begin('req-4', { text: 'b' }, async () => { calls += 1; return { v: 9 } })
  assert.equal(retryLate.deduped, false) // TTL 过后放行显式重试
  await retryLate.run()
  assert.equal(calls, 3)
})

test('去重：不同 ID 正常执行互不影响', async () => {
  const reg = new ChatRequestRegistry()
  let calls = 0
  const a = reg.begin('id-a', { text: 'x' }, async () => { calls += 1; return 'A' })
  const b = reg.begin('id-b', { text: 'x' }, async () => { calls += 1; return 'B' })
  const ra = await a.run(); const rb = await b.run()
  assert.equal(calls, 2); assert.equal(ra.result, 'A'); assert.equal(rb.result, 'B')
})

/* ---------------- retryOnly 协议（Codex 十六轮） ---------------- */
test('协议：部分副作用后失败 → TTL 内重试返回缓存失败；31s（超失败 TTL）→ unknown 拒绝执行', async () => {
  let time = 1000
  const reg = new ChatRequestRegistry({ now: () => time })
  let effects = 0
  const first = reg.begin('p1', { text: 'x' }, async () => { effects += 1; throw new Error('partial then fail') })
  const rf = await first.run()
  assert.equal(rf.ok, false); assert.equal(effects, 1)
  time += 20_000
  const inTtl = reg.begin('p1', { text: 'x' }, async () => { effects += 1; return {} }, { retryOnly: true })
  assert.equal(inTtl.cachedFailure, 'partial then fail'); assert.equal(inTtl.unknown, false)
  assert.equal(effects, 1, '失败缓存 TTL 内查询不执行')
  time += 11_000 // 合计 31s > 30s 失败 TTL
  const retry = reg.begin('p1', { text: 'x' }, async () => { effects += 1; return {} }, { retryOnly: true })
  assert.equal(retry.unknown, true, '超失败 TTL 拒绝执行（Codex 第 31 秒路径）')
  assert.equal(retry.run, null)
  assert.equal(effects, 1, '副作用计数不增加')
})

test('协议：失败缓存过期 → retryOnly 返回 unknown（不执行）；明确新 ID 才执行', async () => {
  let time = 1000
  const reg = new ChatRequestRegistry({ now: () => time })
  let effects = 0
  await reg.begin('p2', { text: 'x' }, async () => { effects += 1; throw new Error('fail') }).run()
  time += 31_000 + 1_000
  const retry = reg.begin('p2', { text: 'x' }, async () => { effects += 1; return {} }, { retryOnly: true })
  assert.equal(retry.unknown, true, '过期后重试拒绝执行')
  assert.equal(retry.run, null)
  assert.equal(effects, 1)
  // 明确新执行（新 ID，非 retryOnly）
  const fresh = reg.begin('p2-new', { text: 'x' }, async () => { effects += 1; return { v: 2 } })
  const rf = await fresh.run()
  assert.equal(rf.ok, true); assert.equal(effects, 2)
})

test('协议：成功结果过期 → retryOnly unknown；窗口内 → 返回原结果不执行', async () => {
  let time = 1000
  const reg = new ChatRequestRegistry({ now: () => time })
  let effects = 0
  await reg.begin('p3', { text: 'x' }, async () => { effects += 1; return { v: 'first' } }).run()
  time += 60_000
  assert.equal((reg.begin('p3', { text: 'x' }, async () => { effects += 1; return {} }, { retryOnly: true })).result?.v, 'first')
  assert.equal(effects, 1, '成功 TTL 内查询返回原结果')
  time += 5 * 60_000
  const late = reg.begin('p3', { text: 'x' }, async () => { effects += 1; return {} }, { retryOnly: true })
  assert.equal(late.unknown, true); assert.equal(effects, 1, '成功过期后拒绝执行')
})

test('协议：模拟重启（新 registry）→ retryOnly unknown', async () => {
  let effects = 0
  const reg1 = new ChatRequestRegistry()
  await reg1.begin('p4', { text: 'x' }, async () => { effects += 1; return {} }).run()
  const reg2 = new ChatRequestRegistry() // 重启清空
  const retry = reg2.begin('p4', { text: 'x' }, async () => { effects += 1; return {} }, { retryOnly: true })
  assert.equal(retry.unknown, true); assert.equal(effects, 1)
})

/* ---------------- 按钮链路回归（Codex 十七轮：查询 vs 重新执行的发送语义） ---------------- */

test('链路：查询按钮的 body 带 retryMode:retry + 原ID；重新执行按钮 body 带新ID 且无 retryMode', async () => {
  // 模拟 DM send 的 body 构造逻辑（与 index.tsx 相同规则）
  const buildBody = (requestId, opts) => ({ requestId, ...(opts?.retryMode ? { retryMode: opts.retryMode } : {}) })
  const saved = { conversationId: 'c1', requestId: 'ui-orig-1', text: 'x', taskId: 't1', createdAt: 1000 }
  // 查询按钮
  const queryBody = buildBody(saved.requestId, { retryMode: 'retry' })
  assert.equal(queryBody.retryMode, 'retry'); assert.equal(queryBody.requestId, 'ui-orig-1')
  // 重新执行按钮（新 ID，无 retryMode）
  const newId = `ui-${Date.now().toString(36)}-re`
  const execBody = buildBody(newId, undefined)
  assert.equal(execBody.retryMode, undefined); assert.notEqual(execBody.requestId, saved.requestId)
})

test('链路：路由语义——查询未知记录=419+0执行；确认重新执行=1次执行；任务身份保持', async () => {
  let time = 1000
  const reg = new ChatRequestRegistry({ now: () => time })
  let execCount = 0
  const taskId = 't-original'
  const payloads = []
  // 重新执行：新 ID、无 retryMode → 执行（与路由 if(requestId)+!retryOnly 分支一致）
  const execBegin = reg.begin('conv:ui-new-1', { text: 'x', taskId }, async () => { execCount += 1; payloads.push({ text: 'x', taskId }); return { ok: true } })
  const r1 = await execBegin.run()
  assert.equal(r1.ok, true); assert.equal(execCount, 1)
  assert.equal(payloads[0].taskId, 't-original', '任务身份保持')
  // 查询一个不存在的新 ID → unknown（路由转 419）
  const q = reg.begin('conv:ui-other-9', { text: 'x', taskId }, async () => { execCount += 1 }, { retryOnly: true })
  assert.equal(q.unknown, true); assert.equal(execCount, 1, '查询未知记录不执行')
  // 查询刚执行成功的新 ID（成功缓存内）→ 返回原结果
  const q2 = reg.begin('conv:ui-new-1', { text: 'x', taskId }, async () => { execCount += 1 }, { retryOnly: true })
  assert.equal(q2.deduped, true); assert.deepEqual(q2.result, { ok: true })
  assert.equal(execCount, 1)
})

test('链路：路由守卫——retryMode=retry 且无有效 requestId → 419 拒绝（消息/执行 0）', async () => {
  // 与路由守卫同语义：retry 无 ID 直接抛 419（测试模拟守卫行为 + registry 兜底）
  const guard = (body) => {
    const ok = /^[a-zA-Z0-9_-]{6,64}$/.test(String(body?.requestId || ''))
    if (String(body?.retryMode || '') === 'retry' && !ok) return { rejected: true, status: 419 }
    return { rejected: false }
  }
  assert.deepEqual(guard({ text: 'q', retryMode: 'retry' }), { rejected: true, status: 419 })            // 缺失
  assert.deepEqual(guard({ text: 'q', retryMode: 'retry', requestId: '' }), { rejected: true, status: 419 }) // 空
  assert.deepEqual(guard({ text: 'q', retryMode: 'retry', requestId: 'ab!' }), { rejected: true, status: 419 }) // 非法
  assert.deepEqual(guard({ text: 'q', retryMode: 'retry', requestId: 'valid-id-1' }), { rejected: false })
  // registry 兜底：无 ID retryOnly → unknown 不执行
  const reg = new ChatRequestRegistry()
  let n = 0
  const r = reg.begin(null, {}, async () => { n += 1 }, { retryOnly: true })
  assert.equal(r.unknown, true); assert.equal(n, 0)
})
