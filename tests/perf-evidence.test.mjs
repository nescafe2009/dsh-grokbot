// 效率证据标准回归——真实路由（lib/index.mjs：/api-chat 与 __perf/direct）+ 生产函数
// （perf-fixture/evidence.mjs，与采样 fixture 同源），不复制表达式。
// 覆盖：真实执行 / 口头复述 / 错误输出 / read_file-only / 失败回合——插件与直连同标准。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bashToolEvidence, targetEvidence } from '../perf-fixture/evidence.mjs'

const API_ROOT = '/api/plugins/grokbot'
const HOST_TOKEN = 'evidence-harness-token'
const MARKER = 'COLD-TOOL'

// 场景 → mock agent 事件流（真实 summarizeTurn/activityOf/toolResultTexts 解析）
// #EXEC 真实执行（bash + 结果含标记，回复不复述标记）
// #ECHO 口头复述（无工具，回复含标记）
// #WRONG 工具跑了但输出不含标记
// #READFILE read_file-only（工具结果也不含标记）
// #FAIL 回合报错
function eventsFor(text) {
  const reply = text.includes('#EXEC') ? '已执行完成' : (text.includes(MARKER) ? `输出是 ${MARKER}-173` : '收到')
  const ev = []
  if (text.includes('#EXEC')) {
    ev.push({ type: 'tool/call', data: { name: 'bash' } })
    ev.push({ type: 'tool/result', data: { message: { content: [{ type: 'text', text: `${MARKER}-173\n` }] } } })
  } else if (text.includes('#WRONG')) {
    ev.push({ type: 'tool/call', data: { name: 'bash' } })
    ev.push({ type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'unrelated output' }] } } })
  } else if (text.includes('#READFILE')) {
    ev.push({ type: 'tool/call', data: { name: 'read_file' } })
    ev.push({ type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'file content here' }] } } })
  }
  ev.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: reply }] } } })
  ev.push({ type: 'turn/end', data: text.includes('#FAIL') ? { reason: { kind: 'error', error: { message: 'model exploded' } } } : { reason: { kind: 'completed' } } })
  return { ev, reply }
}

async function startInstance() {
  const { default: plugin } = await import('../lib/index.mjs')
  const stateDir = await mkdtemp(join(tmpdir(), 'evd-'))
  const disposers = []
  const handlers = []
  const ctx = {
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    on() { return () => {} },
    logger: { info() {}, warn() {}, error() {} },
    webServer: { register(route) { handlers.push(route); return () => {} } },
    agents: {
      create: async () => {
        let seq = 0
        const events = []
        return {
          agent: {
            session: { get seq() { return seq }, events },
            whenIdle: async () => {},
            followup(msg) {
              const text = String(msg?.content?.[0]?.text ?? '')
              for (const e of eventsFor(text).ev) events.push({ seq: seq++, ...e })
            },
            cancel() {},
          },
          dispose: async () => {},
        }
      },
      resume: async (base) => ctx.agents.create(base),
    },
    agentDefaultModel: { currentSelection: () => null },
    llm: { listProviders: async () => [], listModels: async () => [] },
  }
  plugin.apply(ctx, { stateDir, testEndpoints: true })
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
    if (Date.now() > deadline) throw new Error('就绪超时')
    await new Promise((r) => setTimeout(r, 100))
  }
  const api = (path, opts) => fetch(`${base}${path}${path.includes('?') ? '&' : '?'}token=${HOST_TOKEN}`, opts)
  return {
    api,
    close: async () => {
      for (const d of disposers.splice(0).reverse()) { try { await d() } catch { /* best effort */ } }
      try { server.closeAllConnections?.() } catch {}
      await new Promise((resolve) => server.close(resolve))
      await rm(stateDir, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}

test('真实路由：执行证据标准——插件与直连同源（真实执行/口头复述/错误输出/read_file/失败）', async () => {
  const inst = await startInstance()
  try {
    // ===== 直连侧（__perf/direct，真实路由响应携带 activity/toolResults）=====
    const direct = async (text) => (await (await inst.api('/__perf/direct', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
    })).json())

    const dExec = await direct(`#EXEC 用 bash echo ${MARKER}`)
    assert.equal(dExec.status, 'ok')
    assert.deepEqual(dExec.activity, ['bash'], '直连响应暴露真实 activity')
    assert.ok(dExec.toolResults.length === 1 && dExec.toolResults[0].includes(MARKER), '直连响应暴露实际工具结果')
    assert.equal(bashToolEvidence(dExec), true, '真实执行：bash 证据成立')
    assert.equal(targetEvidence(dExec, MARKER), true, '真实执行：目标证据成立')
    assert.ok(!dExec.toolResults[0].includes('口头'), '证据来自工具输出而非回复')

    const dEcho = await direct(`只复述 ${MARKER}-173 不要执行工具`)
    assert.equal(bashToolEvidence(dEcho), false, '口头复述：无 bash 证据')
    assert.equal(targetEvidence(dEcho, MARKER), false, '口头复述（reply 含标记）：目标证据不成立')
    assert.ok((dEcho.replyBytes ?? 0) > 0, '（对照）旧 replyBytes>0 标准会被此场景欺骗——新标准不受影响')

    const dWrong = await direct('#WRONG 跑工具但输出别的')
    assert.equal(bashToolEvidence(dWrong), true, '工具确实跑了：bash 证据成立')
    assert.equal(targetEvidence(dWrong, MARKER), false, '错误输出：目标证据不成立')

    const dRead = await direct('#READFILE 只读文件')
    assert.equal(bashToolEvidence(dRead), false, 'read_file-only：不能伪造 bash 证据')
    assert.equal(targetEvidence(dRead, MARKER), false)
    assert.ok((dRead.toolCalls ?? 0) > 0, '（对照）toolCalls>0 存在——但计数本身不构成 bash 证据')

    const dFail = await direct('#FAIL 回合失败')
    assert.equal(dFail.status, 'failed')
    assert.equal(targetEvidence(dFail, MARKER), false, '失败回合：目标证据不成立')
    assert.equal(bashToolEvidence(dFail), false)

    // ===== 插件侧（/conversations/:id/chat，outcome.activity/toolResults 流通）=====
    const chat = async (text) => (await inst.api('/conversations/chief/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, requestId: `evd-${Math.random().toString(36).slice(2)}` }),
    })).json()

    const pExec = await chat(`#EXEC 用 bash echo ${MARKER}`)
    assert.equal(bashToolEvidence(pExec.outcome), true, '插件：真实执行 bash 证据')
    assert.equal(targetEvidence(pExec.outcome, MARKER), true, '插件：目标证据（outcome.toolResults）')
    assert.ok(!pExec.reply.includes(MARKER), '（场景构造）回复不复述标记——证据只可能来自工具结果')

    const pEcho = await chat(`只复述 ${MARKER}-173 不要执行工具`)
    assert.ok(pEcho.reply.includes(MARKER), '（场景构造）回复确实复述了标记')
    assert.equal(bashToolEvidence(pEcho.outcome), false, '插件：口头复述无 bash 证据')
    assert.equal(targetEvidence(pEcho.outcome, MARKER), false, '插件：口头复述目标证据不成立')

    const pWrong = await chat('#WRONG 跑工具但输出别的')
    assert.equal(bashToolEvidence(pWrong.outcome), true)
    assert.equal(targetEvidence(pWrong.outcome, MARKER), false, '插件：错误输出不成立')

    const pRead = await chat('#READFILE 只读文件')
    assert.equal(bashToolEvidence(pRead.outcome), false, '插件：read_file-only 不能伪造 bash')
    assert.equal(targetEvidence(pRead.outcome, MARKER), false)
  } finally { await inst.close() }
})
