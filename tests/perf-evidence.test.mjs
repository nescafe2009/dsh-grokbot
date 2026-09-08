// 效率证据标准回归——真实路由（lib/index.mjs：/api-chat 与 __perf/direct）+ 生产函数
// （perf-fixture/evidence.mjs ←→ src/index.mjs shellExecutionEvidence，双侧共用，不复制表达式）。
// 覆盖（含 Codex 混合工具探针）：真实执行 / 口头复述 / 错误输出 / read_file-only /
// 混合工具（bash 输错 + read_file 含标记）/ 孤立结果 / 错误结果复述 / not_bash 精确名单 /
// 失败回合 / 默认 chat 不附原始工具文本（evidence 仅显式 evidenceMarker 才有）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bashToolEvidence, targetEvidence, SHELL_TOOL_NAMES } from '../perf-fixture/evidence.mjs'
import { shellExecutionEvidence } from '../src/index.mjs'

const API_ROOT = '/api/plugins/grokbot'
const HOST_TOKEN = 'evidence-harness-token'
const MARKER = 'COLD-TOOL'

// 宿主实际事件形状（dsh-agent-loop）：tool/call {callId,name}；
// tool/result {message:{source:{callId},content:[{type:'tool-result',toolCallId,content,isError}]},error?}
function call(callId, name) {
  return { type: 'tool/call', data: { callId, name, arguments: {} } }
}
function result(callId, content, isError = false) {
  return { type: 'tool/result', data: { message: { source: { kind: 'tool', callId }, content: [{ type: 'tool-result', toolCallId: callId, content, isError }] } } }
}
function assistant(reply) {
  return { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: reply }] } } }
}
function turnEnd(kind = 'completed', message) {
  return { type: 'turn/end', data: { reason: kind === 'error' ? { kind: 'error', error: { message: message ?? 'model exploded' } } : { kind } } }
}

// 场景 → 事件流
const SCENARIOS = {
  EXEC: () => [call('c1', 'bash'), result('c1', `${MARKER}-173\n`), assistant('已执行完成'), turnEnd()],
  ECHO: () => [assistant(`输出是 ${MARKER}-173`), turnEnd()], // 口头复述，无工具
  WRONG: () => [call('c1', 'bash'), result('c1', 'unrelated output'), assistant('完成'), turnEnd()],
  MIXED: () => [call('c1', 'bash'), call('c2', 'read_file'), result('c1', 'wrong shell output'), result('c2', `${MARKER}-173`), assistant('完成'), turnEnd()], // Codex 探针
  READFILE: () => [call('c2', 'read_file'), result('c2', 'file content'), assistant('完成'), turnEnd()],
  ISOLATED: () => [call('c1', 'bash'), result('cX', `${MARKER}-173`), assistant('完成'), turnEnd()], // 孤立结果（无对应 call）
  ERRORED: () => [call('c1', 'bash'), result('c1', `${MARKER}-173`, true), assistant('完成'), turnEnd()], // 错误结果复述标记
  NOTBASH: () => [call('c3', 'not_bash'), result('c3', `${MARKER}-173`), assistant('完成'), turnEnd()], // /bash/i 泛化回归
  FAIL: () => [assistant('x'), turnEnd('error')],
}

async function startInstance() {
  const { default: plugin } = await import('../lib/index.mjs')
  const stateDir = await mkdtemp(join(tmpdir(), 'evd2-'))
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
              const key = /#(\w+)/.exec(text)?.[1] ?? 'ECHO'
              for (const e of (SCENARIOS[key] ?? SCENARIOS.ECHO)()) events.push({ seq: seq++, ...e })
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

// 双侧同标准矩阵：[场景, 期望 shellOk(bashToolEvidence), 期望 targetMatch(targetEvidence)]
const MATRIX = [
  ['EXEC', true, true],
  ['ECHO', false, false],
  ['WRONG', true, false],
  ['MIXED', true, false], // bash 真跑了（shellOk）但其输出无标记；read_file 含标记不算
  ['READFILE', false, false],
  ['ISOLATED', true, false], // bash 确被调用（activity 真）；其结果无法关联 call → 目标拒绝
  ['ERRORED', true, false], // bash 确被调用；结果为错误（复述标记）→ 目标拒绝（非成功结果）
  ['NOTBASH', false, false], // 显式名单精确匹配：not_bash 不算
  ['FAIL', false, false],
]

test('真实路由：callId 关联的 shell 成功结果证据——插件与直连同源同标准', async () => {
  const inst = await startInstance()
  try {
    for (const [key, wantBash, wantTarget] of MATRIX) {
      // 直连侧（真实 __perf/direct 路由，响应携带 activity + evidence 生产判定）
      const d = await (await inst.api('/__perf/direct', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `#${key} 用 bash echo ${MARKER}`, evidenceMarker: MARKER }),
      })).json()
      assert.equal(bashToolEvidence(d), wantBash, `direct ${key}: bashToolEvidence 期望 ${wantBash}`)
      assert.equal(targetEvidence(d, MARKER), wantTarget, `direct ${key}: targetEvidence 期望 ${wantTarget}`)
      assert.ok(!('toolResults' in d), `direct ${key}: 不附原始工具文本`)
      // 插件侧（真实 chat 路由 + evidenceMarker 显式请求）
      const p = await (await inst.api('/conversations/chief/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `#${key} 用 bash echo ${MARKER}`, requestId: `evd-${key}-${Math.random().toString(36).slice(2)}`, evidenceMarker: MARKER }),
      })).json()
      assert.equal(bashToolEvidence(p.outcome), wantBash, `plugin ${key}: bashToolEvidence 期望 ${wantBash}`)
      assert.equal(targetEvidence(p.outcome, MARKER), wantTarget, `plugin ${key}: targetEvidence 期望 ${wantTarget}`)
      assert.ok(!('toolResults' in p.outcome), `plugin ${key}: 不附原始工具文本`)
    }
    // 生产函数直测：混合场景的关键语义（同一 shell 成功结果才匹配）
    const mixed = [...SCENARIOS.MIXED().map((e, i) => ({ seq: i, ...e }))]
    assert.deepEqual(shellExecutionEvidence(mixed, 0, MARKER), { shellOk: true, targetMatch: false })
    const exec = [...SCENARIOS.EXEC().map((e, i) => ({ seq: i, ...e }))]
    assert.deepEqual(shellExecutionEvidence(exec, 0, MARKER), { shellOk: true, targetMatch: true })
  } finally { await inst.close() }
})

test('默认 chat 不附 evidence/toolResults（仅显式 evidenceMarker 才返回最小证据）', async () => {
  const inst = await startInstance()
  try {
    const plain = await (await inst.api('/conversations/chief/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '#EXEC 用 bash echo COLD-TOOL', requestId: `evd-plain-${Math.random().toString(36).slice(2)}` }),
    })).json()
    assert.ok(!('evidence' in plain.outcome), '默认 chat 不附 evidence')
    assert.ok(!('toolResults' in plain.outcome), '默认 chat 不附原始工具文本')
    assert.ok(Array.isArray(plain.outcome.activity), 'activity 照常（工具名，非原文）')
    // 直连不带 marker：targetMatch 恒 false（未声明验证目标），shellOk 仍按事件
    const d = await (await inst.api('/__perf/direct', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '#EXEC 用 bash echo COLD-TOOL' }),
    })).json()
    assert.equal(d.evidence.shellOk, true)
    assert.equal(d.evidence.targetMatch, false, '无 evidenceMarker：不验证目标')
  } finally { await inst.close() }
})
