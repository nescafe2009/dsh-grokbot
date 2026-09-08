// 完整产物故事（一条链端到端）——隔离 stateDir + 生产路由/工具/队列 + mock agent（不真实模型）。
// 所有交付卡均由真实 deliver_file/handoff 工具产生（mock 只以"模型"身份调用工具），不手写交付卡。
//
// 故事线：群（原会话，无 chief 成员 → 无幕僚长唤醒干扰）
//   STORY1 writer：task_begin 建任务 → 写 HTML → deliver_file 交 V1
//   STORY2 writer：同 task（POST taskId，续改语义）改文件 → deliver_file 交 V2；V1 字节不变
//   STORY3 writer：handoff(member_id=consumer, task_id, artifact_id=V2) → 生产队列派发
//   consumer：真实 handoff 前言（快照路径+SHA256）→ 实际读取并校验 V2 → 写 V3 → deliver_file
//   V3 卡落回原群（conversationId 随 job），不串 writer/consumer 私聊
//   重启（同 stateDir 再 apply）：版本链/最终卡仍在、任务与房间字节不变、零重派（agents.create=0）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const API_ROOT = '/api/plugins/grokbot'
const HOST_TOKEN = 'story-harness-token'
const V1_BODY = '<!doctype html><html><body><h1>V1 首版</h1></body></html>\n'
const V2_BODY = '<!doctype html><html><body><h1>V2 续改版</h1><p>基于 V1 修改</p></body></html>\n'
const V3_BODY = '<!doctype html><html><body><h1>V3 终版</h1><p>消费 V2 后产出</p></body></html>\n'
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// 故事型 mock agent：setup 收集真实工具；followup 按提示标记驱动工具（模型身份），全计数留证据
function makeStoryAgents() {
  const calls = { create: 0, resume: 0, followups: 0, disposes: 0 }
  const evidence = { story1: null, story2: null, story3: null, consumed: null, turns: [] }
  const create = async (base = {}) => {
    calls.create += 1
    const tools = new Map()
    const agentCtx = { systemPrompt: { section() {} }, tools: { register(t) { tools.set(t.name, t) } } }
    try { await base.setup?.(agentCtx) } catch { /* 记录容忍：工具注册失败由真实 execute 报错暴露 */ }
    const cwd = base.meta?.cwd
    let seq = 0
    const events = []
    let busy = Promise.resolve() // 真实 agent 语义：idle 只在回合（含工具 I/O）完成后到达
    const j = (r) => { try { return JSON.parse(r) } catch { return { raw: String(r) } } }
    return {
      agent: {
        session: { get seq() { return seq }, events },
        whenIdle: async () => { await busy },
        followup(msg) {
          calls.followups += 1
          busy = (async () => {
          const text = String(msg?.content?.[0]?.text ?? '')
          // 群聊提示 = 历史 preamble + '\n\n' + 新用户文本：标记只认末段，防历史里的旧标记误触发
          const tail = text.split('\n\n').at(-1) ?? text
          evidence.turns.push(text.slice(0, 80))
          let reply = '（无动作）'
          try {
            if (tail.includes('#STORY1')) {
              const t = j(await tools.get('task_begin').execute({ title: '产物故事：HTML 报告迭代' }))
              await writeFile(join(cwd, 'story-report.html'), V1_BODY, 'utf8')
              const d = j(await tools.get('deliver_file').execute({ path: 'story-report.html', note: 'V1 首版', task_id: t.taskId }))
              evidence.story1 = { taskId: t.taskId, deliver: d }
              reply = `STORY1 完成：任务 ${t.taskId}，V1 已交付`
            } else if (tail.includes('#STORY2')) {
              await writeFile(join(cwd, 'story-report.html'), V2_BODY, 'utf8')
              const d = j(await tools.get('deliver_file').execute({ path: 'story-report.html', note: 'V2 续改版' }))
              evidence.story2 = { deliver: d }
              reply = 'STORY2 完成：V2 已交付'
            } else if (tail.includes('#STORY3')) {
              const taskId = /task=([a-z0-9-]+)/.exec(text)?.[1] ?? ''
              const artifactId = /artifact=([a-z0-9-]+)/.exec(text)?.[1] ?? ''
              const h = j(await tools.get('handoff').execute({ member_id: 'story-consumer', task_id: taskId, artifact_id: artifactId, brief: '基于指定版本继续，产出终版并交付回本群' }))
              evidence.story3 = { handoff: h }
              reply = `STORY3 完成：已交接 ${h.jobId ?? ''}`
            } else if (text.includes('【接力交接】')) {
              // 真实消费：解析前言中的快照路径与 SHA256，实际读取校验
              const snap = /快照路径：(\S+)/.exec(text)?.[1] ?? ''
              const expect = /SHA256：([0-9a-f]{64})/.exec(text)?.[1] ?? ''
              const buf = await readFile(snap)
              const got = sha256(buf)
              const taskId = /taskId=([a-z0-9-]+)/.exec(text)?.[1] ?? ''
              await writeFile(join(cwd, 'story-final.html'), V3_BODY, 'utf8')
              const d = j(await tools.get('deliver_file').execute({ path: 'story-final.html', note: 'V3 终版', task_id: taskId }))
              evidence.consumed = { snapshot: snap, shaMatch: got === expect, sha: got, isV2Body: buf.toString('utf8') === V2_BODY, deliver: d }
              reply = `交接完成：SHA 校验 ${got === expect ? '一致' : '不一致'}，V3 已交付`
            }
          } catch (error) {
            reply = `MOCK-ACTION-ERROR: ${error?.message ?? error}`
          }
          events.push({ seq: seq++, type: 'user/message', data: { text: 'mock-user' } })
          events.push({ seq: seq++, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: reply }] } } })
          events.push({ seq: seq++, type: 'turn/end', data: { reason: { kind: 'completed' } } })
          })()
        },
        cancel() {},
      },
      dispose: async () => { calls.disposes += 1 },
    }
  }
  return { create, resume: create, calls, evidence }
}

async function startLifecycle(stateDir) {
  const { default: plugin } = await import('../lib/index.mjs')
  const agents = makeStoryAgents()
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
  plugin.apply(ctx, { stateDir, rescanIntervalMs: 1000 }) // 扫描间隔压到下限 1s（配置项，加速队列派发）
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
  const api = (path, opts) => fetch(`${base}${path}${path.includes('?') ? '&' : '?'}token=${HOST_TOKEN}`, opts)
  return {
    base, agents, api,
    chat: (conversationId, body) => api(`/conversations/${encodeURIComponent(conversationId)}/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: `story-${randomUUID()}`, ...body }),
    }),
    closed: false,
    async close() {
      if (this.closed) return
      this.closed = true
      for (const d of disposers.splice(0).reverse()) { try { await d() } catch { /* best effort */ } }
      try { server.closeAllConnections?.() } catch {}
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

test('完整产物故事：V1→V2（V1 不变）→handoff 指定 V2 消费→V3 回原会话→重启版本链稳定', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'as-'))
  let A = null
  let B = null
  try {
    // ===== 生命周期 A：建队建群（HTTP 生产入口）=====
    A = await startLifecycle(stateDir)
    const mk = async (id, name) => (await (await A.api('/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, name }) })).json()).bot
    const writer = await mk('story-writer', '写手')
    const consumer = await mk('story-consumer', '接手')
    const convResp = await A.api('/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '产物故事群', memberBotIds: [writer.id, consumer.id] }) })
    assert.equal(convResp.status, 201)
    const room = (await convResp.json()).conversation

    // STORY1：task_begin + deliver_file V1（真实工具）
    const s1 = await A.chat(room.id, { text: '#STORY1 建任务并交付首版 HTML', mentions: [writer.id] })
    assert.equal(s1.status, 200)
    assert.match((await s1.json()).reply, /STORY1 完成/)
    assert.ok(A.agents.evidence.story1?.taskId, 'task_begin 返回 taskId')

    const hist1 = (await (await A.api(`/conversations/${encodeURIComponent(room.id)}`)).json()).messages
    const card1 = hist1.find((m) => m.artifact)
    assert.ok(card1, 'V1 交付卡已由真实 deliver_file 写入原会话')
    const taskId = card1.artifact.taskId
    const v1Id = card1.artifact.id
    assert.equal(taskId, A.agents.evidence.story1.taskId, '卡片携带任务关联')
    const v1Bytes = await readFile(join(stateDir, 'artifacts', v1Id, 'data', 'payload'))
    const v1Sha = sha256(v1Bytes)

    // STORY2：同任务续改（POST taskId = 卡片续改入口语义）→ V2；V1 不变
    const s2 = await A.chat(room.id, { text: '#STORY2 续改成第二版', mentions: [writer.id], taskId })
    assert.equal(s2.status, 200)
    const hist2 = (await (await A.api(`/conversations/${encodeURIComponent(room.id)}`)).json()).messages
    const cards = hist2.filter((m) => m.artifact)
    assert.equal(cards.length, 2, 'V1/V2 两张卡（不覆盖）')
    const v2Id = cards.at(-1).artifact.id
    assert.notEqual(v2Id, v1Id, 'V2 是新快照')
    assert.equal(cards.at(-1).artifact.taskId, taskId, 'V2 关联同一任务')
    assert.equal(sha256(await readFile(join(stateDir, 'artifacts', v1Id, 'data', 'payload'))), v1Sha, 'V1 字节不变（快照不可变）')
    assert.equal(cards.at(-1).botId, writer.id, 'V2 由 writer 交付')

    // STORY3：handoff 指定 V2 给 consumer（真实工具 → 生产队列）
    const s3 = await A.chat(room.id, { text: `#STORY3 交给接手成员 task=${taskId} artifact=${v2Id}`, mentions: [writer.id] })
    assert.equal(s3.status, 200)
    assert.ok(A.agents.evidence.story3?.handoff?.jobId, 'handoff 返回 jobId')
    assert.equal(A.agents.evidence.story3.handoff.artifactId, v2Id, '交接指定 V2')

    // 等待 consumer 实际消费并交付 V3（扫描 1s + 回合）
    const deadline = Date.now() + 15000
    let hist3 = null
    for (;;) {
      hist3 = (await (await A.api(`/conversations/${encodeURIComponent(room.id)}`)).json()).messages
      if (hist3.filter((m) => m.artifact).length >= 3) break
      if (Date.now() > deadline) throw new Error('等待 V3 交付超时')
      await new Promise((r) => setTimeout(r, 200))
    }
    const cards3 = hist3.filter((m) => m.artifact)
    const v3Card = cards3.at(-1)
    const v3Id = v3Card.artifact.id
    assert.equal(v3Card.botId, consumer.id, 'V3 由 consumer 交付')
    assert.equal(v3Card.artifact.taskId, taskId, 'V3 关联同一任务（交付回原任务）')

    // consumer 实际消费 V2 证据（真实快照读取 + SHA 校验）
    const consumed = A.agents.evidence.consumed
    assert.ok(consumed, 'consumer 回合已执行')
    assert.equal(consumed.shaMatch, true, 'V2 SHA256 校验一致（实际读取消费）')
    assert.equal(consumed.isV2Body, true, '消费的是 V2 内容（非 V1/其他）')

    // 任务索引：run 与成果链
    const { getTask } = await import('../src/tasks.mjs')
    const taskA = await getTask(stateDir, taskId)
    assert.deepEqual(taskA.artifacts, [v1Id, v2Id, v3Id], '版本链 V1→V2→V3（挂载顺序）')
    const origins = taskA.runs.map((r) => r.origin)
    assert.deepEqual(origins, ['user', 'continue', 'handoff'], 'run 归属：首做/续改/交接')
    assert.ok(taskA.runs.every((r) => r.status === 'done'), '三个 run 全部 done')
    const runIndex = taskA.runs.map((r) => ({ id: r.id, origin: r.origin, status: r.status }))
    const artIndex = await Promise.all(taskA.artifacts.map(async (id) => {
      const meta = JSON.parse(await readFile(join(stateDir, 'artifacts', id, 'meta.json'), 'utf8'))
      const payload = await readFile(join(stateDir, 'artifacts', id, 'data', 'payload'))
      return { id, name: meta.name, sha256: meta.sha256, payloadShaMatch: sha256(payload) === meta.sha256, conversationId: meta.conversationId }
    }))
    assert.ok(artIndex.every((a) => a.payloadShaMatch), '三份快照 payload 与 meta.sha256 全部一致')
    assert.ok(artIndex.every((a) => a.conversationId === room.id), '三份快照归属原会话（不串）')

    // 不串会话：两位成员私聊 transcript 无任何交付卡
    for (const botId of [writer.id, consumer.id]) {
      const dm = join(stateDir, 'bots', botId, 'dm-transcript.jsonl')
      const text = await readFile(dm, 'utf8').catch(() => '')
      assert.ok(!text.includes('"artifact"'), `${botId} 私聊无交付卡`)
    }
    // handoff job 完成（replied），队列空
    const stateA = await (await A.api('/state')).json()
    assert.equal(stateA.queueDepth, 0, '队列清空（job 已完成）')

    const roomBytes = await readFile(join(stateDir, 'rooms', `${room.id}.transcript.jsonl`), 'utf8')
    const taskBytes = await readFile(join(stateDir, 'tasks', `${taskId}.json`), 'utf8')
    const artDirs = (await readdir(join(stateDir, 'artifacts'))).sort()
    const createsA = A.agents.calls.create
    const followupsA = A.agents.calls.followups
    await A.close()
    A = null

    // ===== 生命周期 B：重启（同 stateDir）→ 版本链/最终卡仍在，零重派 =====
    B = await startLifecycle(stateDir)
    assert.equal(B.agents.calls.create, 0, '重启零重跑：不重派已完成 job')
    assert.equal(await readFile(join(stateDir, 'rooms', `${room.id}.transcript.jsonl`), 'utf8'), roomBytes, '房间 transcript 字节不变（卡不重复）')
    assert.equal(await readFile(join(stateDir, 'tasks', `${taskId}.json`), 'utf8'), taskBytes, '任务文件字节不变')
    assert.deepEqual((await readdir(join(stateDir, 'artifacts'))).sort(), artDirs, '成果目录无新增/删除')
    const taskB = await getTask(stateDir, taskId)
    assert.deepEqual(taskB.artifacts, [v1Id, v2Id, v3Id], '重启后版本链一致')
    assert.equal(sha256(await readFile(join(stateDir, 'artifacts', v1Id, 'data', 'payload'))), v1Sha, '重启后 V1 仍不变')
    const histB = (await (await B.api(`/conversations/${encodeURIComponent(room.id)}`)).json()).messages
    assert.equal(histB.filter((m) => m.artifact).length, 3, '重启后最终卡恰三张（不重复交付）')
    assert.equal(histB.filter((m) => m.artifact).at(-1).artifact.id, v3Id, '最终卡仍是 V3')
    const stateB = await (await B.api('/state')).json()
    assert.equal(stateB.queueDepth, 0)

    console.log(JSON.stringify({
      event: 'artifact-story-evidence',
      conversationId: room.id,
      taskId,
      runs: runIndex,
      artifacts: artIndex,
      consumed: { shaMatch: consumed.shaMatch, isV2Body: consumed.isV2Body },
      lifecycles: { A: { agentsCreate: createsA, followups: followupsA }, B: { agentsCreate: B.agents.calls.create } },
    }))
  } finally {
    if (A) await A.close()
    if (B) await B.close()
    await rm(stateDir, { recursive: true, force: true }).catch(() => undefined)
  }
})
