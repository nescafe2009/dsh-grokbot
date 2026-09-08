// 重启恢复独立验证——真实生产持久化/初始化入口（lib/index.mjs apply→init），不复制恢复算法。
//
// 生命周期 A：HTTP chat（真实 chatTurn + mock agent）产生 DM 历史 → dispose
// 种子（真实持久化模块/格式）：任务 4 run（done/failed/cancelled/running）+ 成果快照挂卡
//   + DM 交付卡行（appendDm 格式）+ inbox enqueueJob→claimJob（生产 claim 写 status=claimed）
// 生命周期 B（同 stateDir 重新 apply）：恢复断言——历史原样、终态 run 不重派不重复交付、
//   claimed job→failed（不盲重跑）、running run→interrupted、stats/crew 字节不变、agents.create=0
// 生命周期 C（二次重启）：幂等——claimed 状态文件字节不变、interrupted endedAt 不变、仍零重跑
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const API_ROOT = '/api/plugins/grokbot'
const HOST_TOKEN = 'rr-harness-token'

// 记录型 mock agent：不真实模型；create/followup/dispose 全计数，事件可被真实 summarizeTurn 解析
function makeRecordingAgents() {
  const calls = { create: 0, resume: 0, followups: 0, disposes: 0 }
  const create = async () => {
    calls.create += 1
    let seq = 0
    const events = []
    return {
      agent: {
        session: { get seq() { return seq }, events },
        whenIdle: async () => {},
        followup() {
          calls.followups += 1
          events.push({ seq: seq++, type: 'user/message', data: { text: 'mock-user' } })
          events.push({ seq: seq++, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'mock reply ok' }] } } })
          events.push({ seq: seq++, type: 'turn/end', data: { reason: { kind: 'completed' } } })
        },
        cancel() {},
      },
      dispose: async () => { calls.disposes += 1 },
    }
  }
  return { create, resume: create, calls }
}

async function startLifecycle(stateDir) {
  const { default: plugin } = await import('../lib/index.mjs')
  const agents = makeRecordingAgents()
  const disposers = []
  const handlers = []
  const ctx = {
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    on() { return () => {} },
    logger: { info() {}, warn() {}, error() {} },
    webServer: { register(route) { handlers.push(route); return () => {} } },
    agents,
    agentDefaultModel: { currentSelection: () => null },
    llm: { listProviders: async () => [], listModels: async () => [] },
  }
  plugin.apply(ctx, { stateDir })
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (!url.pathname.startsWith(API_ROOT) || url.searchParams.get('token') !== HOST_TOKEN) {
      res.writeHead(url.pathname.startsWith(API_ROOT) ? 401 : 404); res.end(); return
    }
    void handlers[0].handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${API_ROOT}`
  const deadline = Date.now() + 8000
  for (;;) {
    try { if ((await fetch(`${base}/health?token=${HOST_TOKEN}`)).ok) break } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error('lifecycle 就绪超时')
    await new Promise((r) => setTimeout(r, 100))
  }
  return {
    base,
    agents,
    api: (path, opts) => fetch(`${base}${path}${path.includes('?') ? '&' : '?'}token=${HOST_TOKEN}`, opts),
    close: async () => {
      for (const d of disposers.splice(0).reverse()) { try { await d() } catch { /* best effort */ } }
      try { server.closeAllConnections?.() } catch {}
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

test('重启恢复：历史正确恢复、终态不重派不重复交付、在途按设计恢复、二次重启幂等', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'rr-'))
  const inboxRoot = join(stateDir, 'inbox')
  try {
    // ===== 生命周期 A：真实 HTTP chat 产生 DM 历史 =====
    const A = await startLifecycle(stateDir)
    const stateA0 = await (await A.api('/state')).json()
    const botId = stateA0.bots[0].id
    assert.ok(botId, '默认 crew 至少一个 bot')

    const chat = await A.api(`/conversations/${encodeURIComponent(botId)}/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '重启恢复探针：请回复', requestId: `rr-${randomUUID()}` }),
    })
    assert.equal(chat.status, 200)
    const chatOutcome = await chat.json()
    assert.equal(chatOutcome.reply, 'mock reply ok', 'chatTurn 经 mock agent 完成真实回合')
    assert.equal(A.agents.calls.create, 1, 'A 生命周期恰好创建 1 个会话')

    const histA = await (await A.api(`/conversations/${encodeURIComponent(botId)}`)).json()
    assert.ok(histA.messages.length >= 2, 'DM 已持久化用户+回复')
    const dmPath = join(stateDir, 'bots', botId, 'dm-transcript.jsonl')
    await A.close()
    const statsA = await readFile(join(stateDir, 'bots', botId, 'stats.json'), 'utf8')
    const crewA = await readFile(join(stateDir, 'crew.json'), 'utf8')

    // ===== 种子：真实持久化模块写入各类状态（A 已退出，无并发）=====
    const { createTask, startRun, endRun, attachArtifact, getTask } = await import('../src/tasks.mjs')
    const { createArtifactSnapshot } = await import('../src/delivery-core.mjs')
    const { enqueueJob, claimJob } = await import('../src/inbox.mjs')
    const workspace = join(stateDir, 'workspace')
    const task = await createTask(stateDir, { conversationId: null, ownerBotId: botId, workspace, title: '重启恢复任务' })
    const rDone = (await startRun(stateDir, task.id, { botId, origin: 'user' })).run
    await endRun(stateDir, task.id, rDone.id, 'done')
    const rFailed = (await startRun(stateDir, task.id, { botId, origin: 'continue' })).run
    await endRun(stateDir, task.id, rFailed.id, 'failed')
    const rCancelled = (await startRun(stateDir, task.id, { botId, origin: 'handoff' })).run
    await endRun(stateDir, task.id, rCancelled.id, 'cancelled')
    const rRunning = (await startRun(stateDir, task.id, { botId, origin: 'user' })).run // 留在 running = 崩溃在途

    // 成果：真实快照 + 任务挂载 + DM 交付卡（appendDm 生产格式）
    const artSource = join(workspace, 'recover-report.md')
    await writeFile(artSource, '# 恢复探针成果\n终态不重复交付\n', 'utf8')
    const { meta } = await createArtifactSnapshot({ artifactsRoot: join(stateDir, 'artifacts'), sourceReal: artSource, workspaceRoot: workspace })
    await attachArtifact(stateDir, task.id, meta.id)
    const dmBefore = await readFile(dmPath, 'utf8')
    const cardLine = `${JSON.stringify({ ts: Date.now(), role: 'bot', text: '交付文件：recover-report.md', artifact: { id: meta.id, name: meta.name, size: meta.size, mime: meta.mime, sha256: meta.sha256 } })}\n`
    await writeFile(dmPath, dmBefore.endsWith('\n') ? dmBefore + cardLine : `${dmBefore}\n${cardLine}`, 'utf8')

    // inbox 在途：真实 enqueue + claim（status=claimed）
    const job = await enqueueJob(inboxRoot, { toBot: botId, text: '重启中断的任务' })
    await claimJob(job, botId)
    const claimedStatus = JSON.parse(await readFile(join(job.dir, 'status.json'), 'utf8'))
    assert.equal(claimedStatus.status, 'claimed', '种子后处于 claimed（生产格式）')

    const taskA = await getTask(stateDir, task.id)
    const inboxDirsA = (await readdir(inboxRoot)).filter((d) => d !== 'queue.jsonl').sort()
    const queueA = await readFile(join(inboxRoot, 'queue.jsonl'), 'utf8')

    // ===== 生命周期 B：同 stateDir 重启 =====
    const B = await startLifecycle(stateDir)
    assert.equal(B.agents.calls.create, 0, '重启后不盲重跑：零会话创建')
    assert.equal(B.agents.calls.followups, 0)

    // 任务恢复：终态 run 原样，running → interrupted，无新增
    const taskB = await getTask(stateDir, task.id)
    assert.equal(taskB.runs.length, 4, 'run 数量不变（不重派不加跑）')
    const byId = new Map(taskB.runs.map((r) => [r.id, r]))
    for (const r of taskA.runs) {
      if (r.id === rRunning.id) continue
      assert.deepEqual(byId.get(r.id), r, `终态 run ${r.id}（${r.status}）恢复后逐字段一致`)
    }
    assert.equal(byId.get(rRunning.id).status, 'interrupted', '在途 running run → interrupted（明确恢复）')
    assert.ok(byId.get(rRunning.id).endedAt, 'interrupted 带结束时间')

    // claimed job → failed（不自动重派）
    const jb = JSON.parse(await readFile(join(job.dir, 'status.json'), 'utf8'))
    assert.equal(jb.status, 'failed')
    assert.equal(jb.reason, '宿主重启：执行中断（不自动重派）')
    assert.equal(jb.jobId, job.jobId)
    // 队列无新增、queue.jsonl 字节不变
    const inboxDirsB = (await readdir(inboxRoot)).filter((d) => d !== 'queue.jsonl').sort()
    assert.deepEqual(inboxDirsB, inboxDirsA, '无新 job 目录')
    assert.equal(await readFile(join(inboxRoot, 'queue.jsonl'), 'utf8'), queueA, 'queue.jsonl 不变')

    // 历史/成果/crew/stats：字节级不变，不重复交付（卡仍恰一张）
    const histB = await (await B.api(`/conversations/${encodeURIComponent(botId)}`)).json()
    assert.equal(histB.messages.length, histA.messages.length + 1, 'DM 历史 = A 结束时 + 恰一张交付卡')
    const cards = histB.messages.filter((m) => m.artifact).length
    assert.equal(cards, 1, '不重复交付：交付卡恰一张')
    const artResp = await B.api(`/artifacts/${meta.id}`)
    assert.equal(artResp.status, 200)
    assert.equal(artResp.headers.get('x-artifact-sha256'), meta.sha256, '成果快照字节一致')
    const artList = (await readdir(join(stateDir, 'artifacts'))).sort()
    assert.equal(artList.length, 1, '成果目录无重复快照')
    assert.equal(await readFile(join(stateDir, 'crew.json'), 'utf8'), crewA, 'crew.json 字节不变')
    assert.equal(await readFile(join(stateDir, 'bots', botId, 'stats.json'), 'utf8'), statsA, 'stats 不重复计奖（backfilled 幂等）')

    // /state：会话一致、队列空、recent 记录中断
    const stateB = await (await B.api('/state')).json()
    assert.equal(stateB.bots.map((b) => b.id).join(','), stateA0.bots.map((b) => b.id).join(','), 'bot 阵容一致')
    assert.equal(stateB.queueDepth, 0, '无重派排队')
    const interruptedRecent = stateB.recentJobs.filter((j) => j.error === 'interrupted-by-restart')
    assert.equal(interruptedRecent.length, 1, '恰一条重启中断记录')
    const claimedBytesB = await readFile(join(job.dir, 'status.json'), 'utf8')
    const taskBytesB = await readFile(join(stateDir, 'tasks', `${task.id}.json`), 'utf8')
    await B.close()

    // ===== 生命周期 C：二次重启幂等 =====
    const C = await startLifecycle(stateDir)
    assert.equal(C.agents.calls.create, 0, '二次重启仍零重跑')
    assert.equal(await readFile(join(job.dir, 'status.json'), 'utf8'), claimedBytesB, 'claimed→failed 状态文件二次重启不再改写')
    assert.equal(await readFile(join(stateDir, 'tasks', `${task.id}.json`), 'utf8'), taskBytesB, '任务文件二次重启字节不变（interrupted 不再触碰）')
    assert.equal(await readFile(join(stateDir, 'bots', botId, 'stats.json'), 'utf8'), statsA, 'stats 二次重启不变')
    const histC = await (await C.api(`/conversations/${encodeURIComponent(botId)}`)).json()
    assert.equal(histC.messages.filter((m) => m.artifact).length, 1, '二次重启仍不重复交付')
    const stateC = await (await C.api('/state')).json()
    assert.equal(stateC.queueDepth, 0)
    await C.close()

    console.log(JSON.stringify({
      event: 'restart-recovery-evidence',
      lifecycles: {
        A: { agentsCreate: A.agents.calls.create, followups: A.agents.calls.followups, dmMessagesAfterChat: histA.messages.length },
        B: { agentsCreate: B.agents.calls.create, runsStatuses: taskB.runs.map((r) => r.status).sort() },
        C: { agentsCreate: C.agents.calls.create },
      },
    }))
  } finally {
    await rm(stateDir, { recursive: true, force: true }).catch(() => undefined)
  }
})
