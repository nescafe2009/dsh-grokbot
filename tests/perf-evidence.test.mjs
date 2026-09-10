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
  RETRYFAIL: () => [...Array.from({length:5},()=>({type:'llm/retry-started',data:{}})), turnEnd('error','Connection error.')],
  QUOTA: () => [turnEnd('error', '429: Usage limit reached; reset at 19:37:51')],
  AGENTERROR: () => [{ type: 'agent/error', data: { error: { message: 'provider unavailable' } } }],
  EMPTY: () => [turnEnd()],
  FAIL: () => [assistant('x'), turnEnd('error')],
}

async function startInstance(legacyAccess,jobConfig={}) {
  const { default: plugin } = await import(process.env.GROKBOT_TEST_BUNDLE || '../lib/index.mjs')
  const stateDir = await mkdtemp(join(tmpdir(), 'evd2-'))
  if(legacyAccess)await (await import('node:fs/promises')).writeFile(join(stateDir,'bot-access.json'),JSON.stringify(legacyAccess))
  const disposers = []
  const handlers = []
  const prompts = []
  const registered = []
  const nativeAgents = [], listeners = new Map()
  const ctx = {
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    on(name,fn) { listeners.set(name,fn);return () => listeners.delete(name) },
    logger: { info() {}, warn() {}, error() {} },
    webServer: { register(route) { handlers.push(route); return () => {} } },
    agents: {
      create: async (base={}) => {
        const toolMap=new Map();await base.setup?.({systemPrompt:{section(){}},tools:{register:t=>toolMap.set(t.name,t)}});registered.push(toolMap)
        let pending=Promise.resolve(),release=()=>{}
        let seq = 0
        const events = []
        const handle = {
          agent: {
            id: `agent-${registered.length}`,
            session: { id: `fixture-${registered.length}`, get seq() { return seq }, events, append(type,data){events.push({seq:seq++,type,data})} },
            whenIdle: async () => {await pending},
            followup(msg) {
              const text = String(msg?.content?.[0]?.text ?? '')
              prompts.push(text)
              if(jobConfig.followupTool&&text.endsWith('#CONTROL_TEST')){
                pending=Promise.resolve().then(()=>jobConfig.followupTool(toolMap)).then(()=>{events.push({seq:seq++,...assistant('归档完成')},{seq:seq++,...turnEnd()})})
                return
              }

              if(text.includes('#HOLD')){pending=new Promise(resolve=>{release=resolve});events.push({seq:seq++,...assistant('partial checkpoint')});return}
              const key = [...text.matchAll(/#(\w+)/g)].at(-1)?.[1] ?? 'ECHO'
              for (const e of (SCENARIOS[key] ?? SCENARIOS.ECHO)()) events.push({ seq: seq++, ...e })
            },
            cancel() {events.push({seq:seq++,...turnEnd('aborted')});release()},
          },
          dispose: async () => {release()},
        }
        nativeAgents.push(handle.agent);return handle
      },
      resume: async (base) => ctx.agents.create(base),
    },
    agentDefaultModel: { currentSelection: () => null },
    llm: { listProviders: async () => [], listModels: async () => [] },
  }
  plugin.apply(ctx, { stateDir, testEndpoints: true,...jobConfig })
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
    api, prompts, stateDir, registered, nativeAgents, listeners,
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


test('模型失败和空回复在真实私聊路由及重新读取的历史中可见', async () => {
  const inst = await startInstance()
  try {
    for (const [scenario, expected] of [['RETRYFAIL', '已自动重试 5 次'], ['QUOTA', '19:37:51'], ['AGENTERROR', 'provider unavailable'], ['EMPTY', '模型未返回文本'], ['FAIL', 'model exploded']]) {
      const reply = await (await inst.api('/conversations/chief/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({text: `#${scenario}`, requestId: `error-${scenario}`}),
      })).json()
      assert.ok(reply.reply.includes(expected), JSON.stringify(reply))
      const history = await (await inst.api('/bots/chief/history')).json()
      assert.ok(history.messages.some(m => m.role === 'system' && m.text.includes(expected)))
    }
  } finally { await inst.close() }
})

test('团队默认模型变更后，同一已打开私聊在下一回合采用新模型', async () => {
  const inst = await startInstance()
  const post = body => ({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  try {
    await (await inst.api('/conversations/chief/chat',post({text:'#ECHO',requestId:'before-model-change'}))).json()
    await inst.api('/crew',{...post({defaultModel:{provider:'zai',model:'glm-5.3-flash'}}),method:'PATCH'})
    const saved=await (await inst.api('/crew')).json()
    assert.equal(saved.crew.defaultModel.model,'glm-5.3-flash')
    const reply=await (await inst.api('/conversations/chief/chat',post({text:'#ECHO',requestId:'after-model-change'}))).json()
    assert.equal(reply.outcome.model,'zai/glm-5.3-flash')
  } finally {await inst.close()}
})

test('board production endpoint: known conversation snapshot and unknown conversation rejection',async()=>{
 const inst=await startInstance()
 try{
 const response=await inst.api('/conversations/chief/board');assert.equal(response.status,200)
 const body=await response.json();assert.equal(body.conversationId,'chief');assert.deepEqual(body.rows,[])
 assert.equal((await inst.api('/conversations/missing/board')).status,404)
 }finally{await inst.close()}
})

test('chief DM production path restores project facts, live tool access and unpolluted user transcript',async()=>{
 const inst=await startInstance()
 const post=(path,body)=>inst.api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try{
 const member=await(await post('/bots',{name:'架构师'})).json();assert.ok(member.bot?.id)
 const group=await(await post('/conversations',{name:'已有传输项目',memberBotIds:['chief',member.bot.id]})).json();const id=group.conversation.id
 const {mkdir,writeFile}=await import('node:fs/promises')
 await mkdir(join(inst.stateDir,'rooms'),{recursive:true});await writeFile(join(inst.stateDir,'rooms',`${id}.transcript.jsonl`),JSON.stringify({ts:1,role:'user',text:'只出架构设计，完成后停下，不写代码'})+'\n')
 const {savePlan}=await import('../src/project-board.mjs')
 await savePlan(inst.stateDir,id,[{id:'arch',title:'架构阶段',botId:member.bot.id,dependsOn:[],jobIds:[]}],['chief',member.bot.id],[])
 const reply=await post('/conversations/chief/chat',{text:'继续',requestId:'restore-project'});assert.equal(reply.status,200)
 const prompt=inst.prompts.at(-1);assert.match(prompt,/已有传输项目/);assert.match(prompt,/只出架构设计/);assert.match(prompt,/架构阶段/);assert.match(prompt,/【当前用户消息】\n继续$/)
 const history=await(await inst.api('/conversations/chief')).json();assert.equal(history.messages.find(m=>m.role==='user').text,'继续');assert.ok(!JSON.stringify(history).includes('【幕僚长全局工作简报】'))
 const statusTool=inst.registered.at(-1).get('team_project_status');assert.ok(statusTool)
 const status=JSON.parse(await statusTool.execute({conversation_id:id}));assert.equal(status.projects[0].id,id)
 const invalid=JSON.parse(await inst.registered.at(-1).get('team_send_task').execute({conversation_id:id,member_id:member.bot.id,task:'build everything'}));assert.match(invalid.error,/deliverable/)
 const sent=JSON.parse(await inst.registered.at(-1).get('team_send_task').execute({conversation_id:id,member_id:member.bot.id,task:'Isolated mock task',deliverable:'fixture report',acceptance:'contains fixture result'}));assert.equal(sent.replyTo,id);assert.ok(sent.jobId)
 const savedJob=JSON.parse(await (await import('node:fs/promises')).readFile(join(inst.stateDir,'inbox',sent.jobId,'job.json'),'utf8'));assert.equal(savedJob.conversationId,id);assert.equal(savedJob.toBot,member.bot.id)
 const update=inst.registered.at(-1).get('team_update_plan');const changed=JSON.parse(await update.execute({conversation_id:id,expectedPlanRevision:1,steps:[{id:'arch',title:'新的阶段标题',botId:member.bot.id,dependsOn:[],jobIds:[]}]}));assert.equal(changed.ok,true)
 await post('/conversations/chief/chat',{text:'进展呢',requestId:'refresh-project'});assert.match(inst.prompts.at(-1),/新的阶段标题/)
 }finally{await inst.close()}
})


test('production bot access API rejects persistent grants and supports revocation',async()=>{
 const inst=await startInstance()
 const post=(path,body)=>inst.api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try{
 const before=await(await inst.api('/state')).json();assert.equal(before.accessControl.supported,true);assert.ok(before.bots.every(b=>b.accessMode==='review'))
 assert.equal((await post('/bots/missing/access',{mode:'full'})).status,404)
 assert.equal((await post('/bots/chief/access',{mode:'never'})).status,400)
 await post('/conversations/chief/chat',{text:'#ECHO',requestId:'access-test'})
 for(const path of ['/bots/chief/access','/bots/%63hief/access'])assert.equal((await post(path,{mode:'full'})).status,403)
 const state=await(await inst.api('/state')).json();assert.equal(state.bots.find(b=>b.id==='chief').accessMode,'review')
 const {readFile}=await import('node:fs/promises');await assert.rejects(readFile(join(inst.stateDir,'bot-access.json'),'utf8'),{code:'ENOENT'})
 const revoke=await(await post('/bots/chief/access',{mode:'review'})).json();assert.equal(revoke.mode,'review')
 const access=await(await inst.api('/access-control')).json();assert.ok(access.bots.every(b=>b.mode==='review'))
 const after=JSON.parse(await readFile(join(inst.stateDir,'bot-access.json'),'utf8'));assert.deepEqual(after.fullBots,[]);assert.deepEqual(after.baselines,{})
 }finally{await inst.close()}
})


test('forbidden full grant leaves approvals pending; once and reject still reach native request',async()=>{
 const inst=await startInstance()
 const post=(path,body)=>inst.api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try{
  await post('/conversations/chief/chat',{text:'#ECHO',requestId:'approval-controls'})
  const agent=inst.nativeAgents[0]
  for(const outcome of ['allowed-once','rejected']){
   const id=`pending-${outcome}`,callId=`call-${outcome}`
   agent.session.append('tool/call',{callId,name:'bash',arguments:{command:'echo fixture'}})
   agent.session.append('approval/asked',{id,callId})
   let settled=false
   const decision=inst.listeners.get('approval/request')({agent,callId,toolName:'bash'},()=>{throw Error('unexpected fallback')}).then(value=>{settled=true;return value})
   let pending
   for(let i=0;i<50;i++){
    pending=(await(await inst.api('/state')).json()).approvals.find(a=>a.id===id)
    if(pending?.stage==='user')break
    await new Promise(r=>setTimeout(r,10))
   }
   assert.equal(pending?.stage,'user');assert.equal(settled,false)
   assert.equal((await post('/bots/chief/access',{mode:'full'})).status,403)
   assert.equal(settled,false)
   assert.ok((await(await inst.api('/state')).json()).approvals.some(a=>a.id===id))
   assert.equal((await post(`/approvals/${id}`,{outcome})).status,200)
   assert.equal(await decision,outcome)
  }
 }finally{await inst.close()}
})


test('native UI first step restores legacy permissions or rejects without entering',async()=>{
 for(const mode of ['read-only','danger-full-access']){
  const inst=await startInstance({fullBots:['chief'],baselines:{native:{botId:'chief',mode,policy:'ask'}}})
  try{
   const events=[],agent={session:{id:'native',append(type,data){events.push({type,data})}}}
   let entered=false
   const decision=await inst.listeners.get('agent/pre-step')({agent},()=>{entered=true;return {kind:'enter',messages:[]}})
   if(mode==='read-only'){
    assert.equal(entered,true);assert.equal(decision.kind,'enter');assert.deepEqual(events,[{type:'sandbox/mode',data:{mode:'read-only'}},{type:'approval/policy',data:{policy:'ask'}}])
   }else{
    assert.equal(entered,false);assert.equal(decision.kind,'reject');assert.deepEqual(events,[])
   }
  }finally{await inst.close()}
 }
})


test('live inbox job persists a checkpoint, defaults to no hard limit, and user stop is cancellation',async()=>{
 const inst=await startInstance()
 const post=(path,body)=>inst.api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try{
  const state=await(await inst.api('/state')).json();assert.equal(state.config.jobHardTimeoutMs,0)
  const {job}=await(await post('/inbox',{toBot:'chief',text:'#HOLD'})).json()
  for(let i=0;i<100&&!inst.prompts.some(p=>p.includes('#HOLD'));i++)await new Promise(r=>setTimeout(r,10))
  assert.ok(inst.prompts.some(p=>p.includes('#HOLD')))
  const input={completed:'codec',files:['codec.cpp'],validation:'one test passed',remaining:'networking',blockers:''}
  const result=JSON.parse(await inst.registered.at(-1).get('task_checkpoint').execute(input));assert.equal(result.ok,true)
  const {readFile}=await import('node:fs/promises');const saved=JSON.parse(await readFile(join(job.dir,'checkpoint.json'),'utf8'));assert.equal(saved.remaining,'networking')
  assert.equal((await post('/bots/chief/stop',{})).status,200)
  let status
  for(let i=0;i<100;i++){status=JSON.parse(await readFile(join(job.dir,'status.json'),'utf8'));if(status.status!=='claimed')break;await new Promise(r=>setTimeout(r,10))}
  assert.equal(status.status,'cancelled');assert.match(await readFile(join(job.dir,'reply.md'),'utf8'),/partial checkpoint/)
 }finally{await inst.close()}
})
test('explicit hard cap records partial failure instead of success',async()=>{
 const inst=await startInstance(undefined,{jobHardTimeoutMs:80})
 try{
  const {job}=await(await inst.api('/inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({toBot:'chief',text:'#HOLD'})})).json()
  const {readFile}=await import('node:fs/promises');let status
  for(let i=0;i<150;i++){try{status=JSON.parse(await readFile(join(job.dir,'status.json'),'utf8'));if(status.status==='failed')break}catch{}await new Promise(r=>setTimeout(r,10))}
  assert.equal(status.status,'failed');assert.match(status.error,/尚未完成/);assert.match(await readFile(join(job.dir,'reply.md'),'utf8'),/partial checkpoint/)
 }finally{await inst.close()}
})

test('project lifecycle API archives with a receipt, blocks work, survives reload and restores paused',async()=>{
 const inst=await startInstance()
 const post=(path,body)=>inst.api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try{
  const member=(await(await post('/bots',{name:'生命周期工程师'})).json()).bot
  const room=(await(await post('/conversations',{name:'生命周期项目',memberBotIds:['chief',member.id]})).json()).conversation
  const endpoint=`/conversations/${room.id}`
  let result=await post(`${endpoint}/lifecycle`,{action:'archive',expectedRevision:0,summary:'用户决定换项目，保留未完成事项'})
  assert.equal(result.status,200);assert.equal((await result.json()).lifecycle.status,'archived')
  const board=await(await inst.api(`${endpoint}/board`)).json();assert.equal(board.lifecycle.status,'archived')
  const {readLifecycle}=await import('../src/project-lifecycle.mjs');assert.equal((await readLifecycle(inst.stateDir,room.id)).status,'archived')
  assert.equal((await post(`${endpoint}/lifecycle`,{action:'resume',expectedRevision:1,summary:'错误跳转'})).status,409)
  const calls=inst.prompts.length
  await post(`${endpoint}/chat`,{text:'继续开发',requestId:'frozen-project'})
  assert.equal(inst.prompts.length,calls,'archived group never starts a model turn')
  await post('/conversations/chief/chat',{text:'#ECHO',requestId:'open-chief'})
  const tools=inst.registered.at(-1)
  const denied=JSON.parse(await tools.get('team_send_task').execute({conversation_id:room.id,member_id:member.id,task:'开发',deliverable:'文件',acceptance:'测试'}))
  assert.equal(denied.ok,false);assert.match(denied.error,/archived/)
  const unauthorized=JSON.parse(await tools.get('team_project_lifecycle').execute({conversation_id:room.id,action:'restore',expectedRevision:1,summary:'工具在回合外调用'}))
  assert.equal(unauthorized.ok,false)
  result=await post(`${endpoint}/lifecycle`,{action:'restore',expectedRevision:1,summary:'用户恢复'})
  assert.equal((await result.json()).lifecycle.status,'paused')
  result=await post(`${endpoint}/lifecycle`,{action:'resume',expectedRevision:2,summary:'用户明确继续'})
  assert.equal((await result.json()).lifecycle.status,'active')
 }finally{await inst.close()}
})


test('real lifecycle tool rejects stale revision and cannot report fake archive success',async()=>{
 let projectId,revision=99
 const inst=await startInstance(null,{followupTool:async tools=>tools.get('team_project_lifecycle').execute({conversation_id:projectId,action:'archive',expectedRevision:revision,summary:'用户明确归档旧项目'})})
 const post=(path,body)=>inst.api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try{
  const member=(await(await post('/bots',{name:'工程师'})).json()).bot
  projectId=(await(await post('/conversations',{name:'待归档',memberBotIds:['chief',member.id]})).json()).conversation.id
  let r=await(await post('/conversations/chief/chat',{text:'#CONTROL_TEST',requestId:'stale-control'})).json()
  assert.match(r.reply,/项目状态操作未完成/);assert.doesNotMatch(r.reply,/归档完成/)
  assert.equal((await(await inst.api(`/conversations/${projectId}/board`)).json()).lifecycle.status,'active')
  revision=0
  r=await(await post('/conversations/chief/chat',{text:'#CONTROL_TEST',requestId:'valid-control'})).json()
  assert.match(r.reply,/归档完成/)
  assert.equal((await(await inst.api(`/conversations/${projectId}/board`)).json()).lifecycle.status,'archived')
 }finally{await inst.close()}
})

test('chief conversational acceptance uses delivered request and audits current user message',async()=>{
 let projectId,requestId,toolResult
 const inst=await startInstance(null,{followupTool:async tools=>{toolResult=JSON.parse(await tools.get('team_accept_step').execute({conversation_id:projectId,requestId,expectedRevision:0,evidence:'设计内容已核实'}))}})
 const post=(path,body)=>inst.api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try{
  const member=(await(await post('/bots',{name:'设计师'})).json()).bot
  projectId=(await(await post('/conversations',{name:'对话验收',memberBotIds:['chief',member.id]})).json()).conversation.id
  const {enqueueJob,completeJob}=await import('../src/inbox.mjs')
  const {savePlan,readProjectJobs,projectBoard}=await import('../src/project-board.mjs')
  const {prepareHandoff,flushHandoff}=await import('../src/project-handoff.mjs')
  const inbox=join(inst.stateDir,'inbox')
  const job=await enqueueJob(inbox,{toBot:member.id,conversationId:projectId,text:'design'})
  await completeJob(job,member.id,'设计完成')
  await savePlan(inst.stateDir,projectId,[{id:'s1',title:'设计',botId:member.id,jobIds:[job.jobId],dependsOn:[]}],['chief',member.id],await readProjectJobs(inbox,projectId))
  const board=await projectBoard({stateDir:inst.stateDir,inboxRoot:inbox,conversationId:projectId,bots:[]})
  const handoff=await prepareHandoff(inst.stateDir,projectId,{name:'对话验收',rows:board.rows,epoch:0,summary:'请审阅',originConversationId:'chief'})
  requestId=handoff.requests[0].requestId
  await post('/conversations/chief/chat',{text:'通过设计 #CONTROL_TEST',requestId:'undelivered'})
  assert.equal(toolResult.ok,false)
  await flushHandoff(inst.stateDir,projectId,async()=>{})
  await post('/conversations/chief/chat',{text:'通过设计 #CONTROL_TEST',requestId:'delivered'})
  assert.equal(toolResult.ok,true)
  assert.match(toolResult.lifecycle.reviews.s1.evidence,/用户原话：通过设计/)
  const denied=JSON.parse(await inst.registered.at(-1).get('team_accept_step').execute({conversation_id:projectId,requestId,expectedRevision:1,evidence:'后台'}))
  assert.equal(denied.ok,false);assert.match(denied.error,/当前用户对话/)
 }finally{await inst.close()}
})

test('restart reconciliation returns reviewed delivery to chief DM once and preserves group report',async()=>{
 const inst=await startInstance(null,{rescanIntervalMs:1000})
 const post=(path,body)=>inst.api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try{
  const member=(await(await post('/bots',{name:'交接工程师'})).json()).bot
  const projectId=(await(await post('/conversations',{name:'发起会话回流',memberBotIds:['chief',member.id]})).json()).conversation.id
  const {enqueueJob,completeJob}=await import('../src/inbox.mjs')
  const {savePlan,readProjectJobs}=await import('../src/project-board.mjs')
  const {mkdir,writeFile,readFile}=await import('node:fs/promises')
  const inbox=join(inst.stateDir,'inbox'),job=await enqueueJob(inbox,{toBot:member.id,conversationId:projectId,text:'设计'})
  await completeJob(job,member.id,'交付')
  await mkdir(join(inst.stateDir,'workspace'),{recursive:true})
  await writeFile(join(inst.stateDir,'workspace/design.md'),'# Reviewed design')
  await writeFile(join(job.dir,'checkpoint.json'),JSON.stringify({files:['design.md'],completed:'设计'}))
  await savePlan(inst.stateDir,projectId,[{id:'design',title:'设计稿',botId:member.id,jobIds:[job.jobId],dependsOn:[]}],['chief',member.id],await readProjectJobs(inbox,projectId))
  await mkdir(join(inst.stateDir,'rooms'),{recursive:true})
  const roomPath=join(inst.stateDir,'rooms',`${projectId}.transcript.jsonl`)
  await writeFile(roomPath,JSON.stringify({ts:Date.now(),role:'bot',botId:'chief',text:'设计已检查，请确认'})+'\n')
  let messages=[]
  for(let i=0;i<50;i++){
    messages=(await(await inst.api('/bots/chief/history')).json()).messages
    if(messages.some(m=>m.projectId===projectId))break
    await new Promise(r=>setTimeout(r,100))
  }
  assert.equal(messages.filter(m=>m.projectId===projectId).length,1)
  const notification=messages.find(m=>m.projectId===projectId)
  assert.match(notification.text,/请你审阅/)
  const artifactPath=notification.text.match(/\]\(\/api\/plugins\/grokbot(\/artifacts\/[^)]+)\)/)?.[1]
  assert.ok(artifactPath,'notification has a directly openable snapshot')
  assert.match(await(await inst.api(artifactPath)).text(),/Reviewed design/)
  assert.match(await readFile(roomPath,'utf8'),/设计已检查/)
  await new Promise(r=>setTimeout(r,1200))
  messages=(await(await inst.api('/bots/chief/history')).json()).messages
  assert.equal(messages.filter(m=>m.projectId===projectId).length,1)
 }finally{await inst.close()}
})

test('chief engineering review cannot substitute for user delivery acceptance',async()=>{
 let projectId,stepId,fingerprint,revision=0,result
 const inst=await startInstance(null,{followupTool:async tools=>{result=JSON.parse(await tools.get('team_review_step').execute({conversation_id:projectId,stepId,expectedRevision:revision,expectedFingerprint:fingerprint,evidence:'已独立核实工程测试结果'}))}})
 const post=(path,body)=>inst.api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try{
  const member=(await(await post('/bots',{name:'工程审核'})).json()).bot
  projectId=(await(await post('/conversations',{name:'分工审核',memberBotIds:['chief',member.id]})).json()).conversation.id
  const {enqueueJob,completeJob}=await import('../src/inbox.mjs')
  const {savePlan,readProjectJobs}=await import('../src/project-board.mjs')
  const {deliveryFingerprint,readLifecycle}=await import('../src/project-lifecycle.mjs')
  const inbox=join(inst.stateDir,'inbox'),steps=[]
  for(const [id,reviewMode] of [['build','chief'],['delivery','user']]){
   const job=await enqueueJob(inbox,{toBot:member.id,conversationId:projectId,text:id});await completeJob(job,member.id,'完成')
   steps.push({id,title:id,reviewMode,botId:member.id,jobIds:[job.jobId],dependsOn:id==='delivery'?['build']:[]})
  }
  await savePlan(inst.stateDir,projectId,steps,['chief',member.id],await readProjectJobs(inbox,projectId))
  stepId='build';fingerprint=deliveryFingerprint(await readLifecycle(inst.stateDir,projectId),steps[0])
  await post('/conversations/chief/chat',{text:'核实工程 #CONTROL_TEST',requestId:'chief-review'})
  assert.equal(result.ok,true);assert.equal(result.lifecycle.reviews.build.actor,'chief')
  stepId='delivery';fingerprint=deliveryFingerprint(await readLifecycle(inst.stateDir,projectId),steps[1]);revision=1
  await post('/conversations/chief/chat',{text:'核实交付 #CONTROL_TEST',requestId:'cannot-substitute'})
  assert.equal(result.ok,false);assert.match(result.error,/用户决定/)
 }finally{await inst.close()}
})

test('chief tools execute repair and peer retest without changing the original plan owner',async()=>{
 let toolName,args,result,serial=0
 const inst=await startInstance(null,{rescanIntervalMs:1000,followupTool:async tools=>{result=JSON.parse(await tools.get(toolName).execute(args))}})
 const post=(path,body)=>inst.api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 const run=async(name,params)=>{toolName=name;args=params;await post('/conversations/chief/chat',{text:'处理本项目 #CONTROL_TEST',requestId:`rework-${++serial}`});return result}
 try{
  const dev=(await(await post('/bots',{name:'返工开发'})).json()).bot,qa=(await(await post('/bots',{name:'复测工程师'})).json()).bot
  const id=(await(await post('/conversations',{name:'返工闭环',memberBotIds:['chief',dev.id,qa.id]})).json()).conversation.id
  const {enqueueJob,completeJob}=await import('../src/inbox.mjs'),{savePlan,readProjectJobs}=await import('../src/project-board.mjs')
  const inbox=join(inst.stateDir,'inbox'),old=await enqueueJob(inbox,{toBot:dev.id,conversationId:id,text:'old delivery'});await completeJob(old,dev.id,'delivered')
  await savePlan(inst.stateDir,id,[{id:'core',title:'核心',botId:dev.id,dependsOn:[],jobIds:[old.jobId],reviewMode:'chief'},{id:'release',title:'最终验收',botId:qa.id,dependsOn:['core'],jobIds:[],reviewMode:'user'}],['chief',dev.id,qa.id],await readProjectJobs(inbox,id))
  const board=async()=> (await(await inst.api(`/conversations/${id}/board`)).json())
  let b=await board()
  result=await run('team_return_step',{conversation_id:id,stepId:'core',expectedRevision:0,expectedFingerprint:b.rows[0].fingerprint,reason:'回归失败',evidence:'case-17 failed',criteria:'case-17 PASS',testerBotId:qa.id})
  assert.equal(result.ok,true)
  const send=(phase,member)=>run('team_send_task',{conversation_id:id,step_id:'core',work_kind:phase,member_id:member,task:'#ECHO',deliverable:'单项产物',acceptance:'核验报告'})
  assert.equal((await send('normal',dev.id)).ok,false)
  assert.equal((await send('retest',qa.id)).ok,false)
  const repair=await send('repair',dev.id);assert.equal(repair.ok,true)
  async function until(status){for(let n=0;n<100;n++){const b=await board();if(b.rows.find(r=>r.id==='core')?.status===status)return b;await new Promise(r=>setTimeout(r,50))}throw Error(`never reached ${status}`)}
  await until('awaiting_retest')
  const retest=await send('retest',qa.id);assert.equal(retest.ok,true)
  b=await until('retest_review')
  assert.equal(b.rows.find(r=>r.id==='core').botId,dev.id)
  assert.equal(b.rows.find(r=>r.id==='core').rework.testJobId,retest.jobId)
  result=await run('team_review_step',{conversation_id:id,stepId:'core',expectedRevision:b.lifecycle.revision,expectedFingerprint:b.rows[0].fingerprint,evidence:'只修复未核实复测'})
  assert.equal(result.ok,false)
  result=await run('team_record_retest',{conversation_id:id,stepId:'core',expectedRevision:b.lifecycle.revision,generation:1,testJobId:retest.jobId,result:'passed',evidence:'case-17 实际报告 PASS'})
  assert.equal(result.ok,true)
  b=await board()
  result=await run('team_review_step',{conversation_id:id,stepId:'core',expectedRevision:b.lifecycle.revision,expectedFingerprint:b.rows[0].fingerprint,evidence:'核实修复及复测报告'})
  assert.equal(result.ok,true)
  b=await board();assert.equal(b.rows.find(r=>r.id==='core').status,'done');assert.equal(b.rows.find(r=>r.id==='release').status,'planned')
  const unauthorized=JSON.parse(await inst.registered.find(t=>t.has('team_return_step')).get('team_return_step').execute({conversation_id:id}))
  assert.equal(unauthorized.ok,false)
 }finally{await inst.close()}
})

test('真实私聊路由：排队前持久用户消息，重试与重新读取保留双向身份，不合并合法同文消息', async () => {
 const inst=await startInstance()
 const post=(body)=>inst.api('/conversations/chief/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try {
  const request={text:'#HOLD',requestId:'message-identity-first'}
  const running=post(request)
  let messages=[]
  for(let i=0;i<80;i++){
   messages=(await(await inst.api('/conversations/chief')).json()).messages||[]
   if(messages.some(m=>m.requestId===request.requestId)&&inst.prompts.some(p=>p.includes('#HOLD')))break
   await new Promise(r=>setTimeout(r,20))
  }
  const pendingUser=messages.filter(m=>m.role==='user'&&m.requestId===request.requestId)
  assert.equal(pendingUser.length,1)
  assert.equal(pendingUser[0].messageId,'chat-message-identity-first-user')
  const retry=post({...request,retryMode:'retry'})
  for(const agent of inst.nativeAgents) agent.cancel()
  assert.equal((await running).status,200)
  assert.equal((await retry).status,200)
  messages=(await(await inst.api('/conversations/chief')).json()).messages
  assert.equal(messages.filter(m=>m.role==='user'&&m.requestId===request.requestId).length,1)
  assert.equal(messages.filter(m=>m.role==='bot'&&m.requestId===request.requestId).length,1)
  assert.equal(new Set(messages.map(m=>m.messageId)).size,messages.length)
 }finally{await inst.close()}
})

test('真实私聊路由：相同文字新请求独立执行、同一请求重试只返回原结果',async()=>{
 const inst=await startInstance()
 const post=(body)=>inst.api('/conversations/chief/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try {
  const before=inst.prompts.length
  for(const requestId of ['same-text-first','same-text-second'])assert.equal((await post({text:'#ECHO',requestId})).status,200)
  assert.equal(inst.prompts.length,before+2)
  const reply=await(await post({text:'#ECHO',requestId:'same-text-second',retryMode:'retry'})).json()
  assert.equal(reply.deduped,true)
  assert.equal(inst.prompts.length,before+2)
  assert.equal(reply.messages.filter(m=>m.role==='user'&&m.text==='#ECHO').length,2)
  assert.equal(reply.messages.filter(m=>m.role==='bot'&&m.requestId?.startsWith('same-text-')).length,2)
 }finally{await inst.close()}
})

test('真实工具链：前置验收恢复自动重派未开始的取消任务，重复验收不重复派发',async()=>{
 let args,result,serial=0
 const inst=await startInstance(null,{rescanIntervalMs:1000,followupTool:async tools=>{result=JSON.parse(await tools.get('team_review_step').execute(args))}})
 const post=(path,body)=>inst.api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try{
  const dev=(await(await post('/bots',{name:'开发'})).json()).bot,qa=(await(await post('/bots',{name:'测试'})).json()).bot
  const id=(await(await post('/conversations',{name:'恢复下游',memberBotIds:['chief',dev.id,qa.id]})).json()).conversation.id
  const {enqueueJob,completeJob,cancelJob}=await import('../src/inbox.mjs'),{savePlan,readPlan,readProjectJobs}=await import('../src/project-board.mjs'),{readLifecycle,deliveryFingerprint,stepFingerprint}=await import('../src/project-lifecycle.mjs')
  const inbox=join(inst.stateDir,'inbox')
  const build=await enqueueJob(inbox,{toBot:dev.id,conversationId:id,text:'工程完成'});await completeJob(build,dev.id,'PASS')
  const steps=[{id:'build',title:'工程',reviewMode:'chief',botId:dev.id,dependsOn:[],jobIds:[build.jobId]},{id:'test',title:'质量测试',reviewMode:'user',botId:qa.id,dependsOn:['build'],jobIds:[]}]
  const old=await enqueueJob(inbox,{toBot:qa.id,fromBotId:'chief',conversationId:id,text:'#ECHO 运行质量测试',projectStep:{id:'test',fingerprint:stepFingerprint(steps[1]),generation:0,phase:'normal'}})
  await cancelJob(old,qa.id,'工作包范围或依赖在排队后发生变化，请重新派发')
  steps[1].jobIds=[old.jobId]
  await savePlan(inst.stateDir,id,steps,['chief',dev.id,qa.id],await readProjectJobs(inbox,id))
  const plan=await readPlan(inst.stateDir,id),state=await readLifecycle(inst.stateDir,id)
  args={conversation_id:id,stepId:'build',expectedRevision:state.revision,expectedFingerprint:deliveryFingerprint(state,plan.steps[0]),evidence:'build-report PASS 已核实'}
  await post('/conversations/chief/chat',{text:'核实工程并继续 #CONTROL_TEST',requestId:`auto-retry-${++serial}`})
  assert.equal(result.ok,true,result.error);assert.equal(result.resumed.length,1)
  let jobs=await readProjectJobs(inbox,id),retried=jobs.filter(j=>j.retryOf===old.jobId)
  assert.equal(retried.length,1);assert.equal(retried[0].jobId,result.resumed[0].jobId)
  assert.equal(jobs.find(j=>j.jobId===old.jobId).record.status,'cancelled');assert.equal(jobs.find(j=>j.jobId===old.jobId).record.startedAt,null)
  args={...args,expectedRevision:result.lifecycle.revision}
  await post('/conversations/chief/chat',{text:'重复核实工程 #CONTROL_TEST',requestId:`auto-retry-${++serial}`})
  assert.equal(result.ok,false);assert.match(result.error,/已验收/)
  jobs=await readProjectJobs(inbox,id);assert.equal(jobs.filter(j=>j.retryOf===old.jobId).length,1)
 }finally{await inst.close()}
})

test('真实工具链：旧范围的取消任务不得通过team_retry_step重放',async()=>{
 let args,result
 const inst=await startInstance(null,{followupTool:async tools=>{result=JSON.parse(await tools.get('team_retry_step').execute(args))}})
 const post=(path,body)=>inst.api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try{
  const dev=(await(await post('/bots',{name:'开发'})).json()).bot
  const id=(await(await post('/conversations',{name:'范围变更',memberBotIds:['chief',dev.id]})).json()).conversation.id
  const {enqueueJob,cancelJob}=await import('../src/inbox.mjs'),{savePlan,readProjectJobs}=await import('../src/project-board.mjs'),{stepFingerprint}=await import('../src/project-lifecycle.mjs')
  const inbox=join(inst.stateDir,'inbox'),step={id:'core',title:'旧需求',botId:dev.id,dependsOn:[],jobIds:[]}
  const old=await enqueueJob(inbox,{toBot:dev.id,fromBotId:'chief',conversationId:id,text:'旧需求实现',projectStep:{id:'core',fingerprint:stepFingerprint(step),generation:0,phase:'normal'}})
  await cancelJob(old,dev.id,'工作包范围或依赖在排队后发生变化，请重新派发');step.jobIds=[old.jobId]
  let plan=await savePlan(inst.stateDir,id,[step],['chief',dev.id],await readProjectJobs(inbox,id))
  await savePlan(inst.stateDir,id,[{...step,title:'全新需求'}],['chief',dev.id],await readProjectJobs(inbox,id),plan.revision)
  args={conversation_id:id,jobId:old.jobId,reason:'用户同意继续'}
  await post('/conversations/chief/chat',{text:'继续 #CONTROL_TEST',requestId:'old-scope-retry'})
  assert.equal(result.ok,false);assert.match(result.error,/范围或返工轮次已变化/)
  assert.equal((await readProjectJobs(inbox,id)).length,1)
 }finally{await inst.close()}
})

test('真实工具链：用户委托技术验收后幕僚长可审核常规阶段，最终交付仍需用户',async()=>{
 let name,args,result,serial=0
 const inst=await startInstance(null,{followupTool:async tools=>{result=JSON.parse(await tools.get(name).execute(args))}})
 const post=(path,body)=>inst.api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 const run=async(tool,params,text='技术验收由你组织，我只确认最终体验')=>{name=tool;args=params;await post('/conversations/chief/chat',{text:`${text} #CONTROL_TEST`,requestId:`delegate-${++serial}`});return result}
 try{
  const dev=(await(await post('/bots',{name:'开发'})).json()).bot
  const id=(await(await post('/conversations',{name:'委托验收',memberBotIds:['chief',dev.id]})).json()).conversation.id
  const {enqueueJob,completeJob}=await import('../src/inbox.mjs'),{savePlan,readPlan,readProjectJobs}=await import('../src/project-board.mjs'),{readLifecycle,deliveryFingerprint}=await import('../src/project-lifecycle.mjs')
  const inbox=join(inst.stateDir,'inbox'),job=await enqueueJob(inbox,{toBot:dev.id,conversationId:id,text:'技术成果'});await completeJob(job,dev.id,'报告 PASS')
  await savePlan(inst.stateDir,id,[{id:'core',title:'核心功能',botId:dev.id,reviewMode:'user',dependsOn:[],jobIds:[job.jobId]},{id:'release',title:'最终体验',botId:dev.id,reviewMode:'user',dependsOn:['core'],jobIds:[]}],['chief',dev.id],await readProjectJobs(inbox,id))
  const before=await readLifecycle(inst.stateDir,id),plan=await readPlan(inst.stateDir,id),fingerprint=deliveryFingerprint(before,plan.steps[0])
  let r=await run('team_set_review_policy',{conversation_id:id,stepId:'core',expectedRevision:before.revision,mode:'chief',evidence:'用户明确技术验收由幕僚长组织'})
  assert.equal(r.ok,true,r.error);assert.equal(r.lifecycle.reviewPolicies.core.mode,'chief');assert.equal(deliveryFingerprint(r.lifecycle,plan.steps[0]),fingerprint)
  r=await run('team_review_step',{conversation_id:id,stepId:'core',expectedRevision:r.lifecycle.revision,expectedFingerprint:fingerprint,evidence:'已读取实际技术报告 PASS'})
  assert.equal(r.ok,true,r.error);assert.equal(r.lifecycle.reviews.core.actor,'chief')
  r=await run('team_set_review_policy',{conversation_id:id,stepId:'release',expectedRevision:r.lifecycle.revision,mode:'chief',evidence:'技术验收委托'})
  assert.equal(r.ok,false);assert.match(r.error,/最终交付/)
  const outside=JSON.parse(await inst.registered.find(t=>t.has('team_set_review_policy')).get('team_set_review_policy').execute({conversation_id:id,stepId:'core',expectedRevision:2,mode:'user',evidence:'后台自行调整'}))
  assert.equal(outside.ok,false);assert.match(outside.error,/当前用户对话/)
 }finally{await inst.close()}
})

test('真实HTTP：常用模型持久化及Bot分配返回准确模型',async()=>{
 const inst=await startInstance()
 const patch=async(path,body)=>inst.api(path,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 try{
  const model={provider:'custom-provider',model:'custom-model'}
  const saved=await patch('/crew',{modelPresets:[{name:'常用',...model}]});assert.equal(saved.status,200)
  assert.deepEqual((await(await inst.api('/crew')).json()).crew.modelPresets,[{name:'常用',...model}])
  const assigned=await(await patch('/bots/chief',{model})).json();assert.deepEqual(assigned.bot.model,model)
  assert.deepEqual((await(await inst.api('/bots/chief')).json()).bot.model,model)
  await patch('/crew',{modelPresets:[]});assert.deepEqual((await(await inst.api('/bots/chief')).json()).bot.model,model)
  assert.equal((await(await patch('/bots/chief',{model:null})).json()).bot.model,null)
  const invalid=await patch('/crew',{modelPresets:[{provider:'p',model:''}]});assert.equal(invalid.status,400)
 }finally{await inst.close()}
})
