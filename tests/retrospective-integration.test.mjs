import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import plugin from '../lib/index.mjs'

test('native chief tool publishes from user turn, specialist/background denied, report route and cached prompt refresh work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'retro-native-')),disposers=[],hooks=new Map(),entries=[];let route,run=null
 await mkdir(join(root,'workspace'));await mkdir(join(root,'project-plans'))
 await writeFile(join(root,'crew.json'),JSON.stringify({bots:[{id:'chief',name:'幕僚长'},{id:'dev',name:'开发',title:'macOS 开发'}],conversations:[{id:'p',name:'测试项目',memberBotIds:['chief','dev']}]}))
 await writeFile(join(root,'project-plans','p.json'),JSON.stringify({steps:[{id:'s',title:'实现',botId:'dev',dependsOn:[],jobIds:[]}],revision:1}))
 const ctx={effect(fn){const d=fn();if(typeof d==='function')disposers.push(d)},on(n,fn){hooks.set(n,fn);return()=>{}},logger:{info(){},warn(){},error(){}},webServer:{register(r){route=r;return()=>{}}},agentDefaultModel:{currentSelection:()=>null},llm:{listProviders:async()=>[],listModels:async()=>[]},agents:{}}
 ctx.agents.create=async base=>{
  const sections=[],tools=new Map();await base.setup({systemPrompt:{section:s=>sections.push(s)},tools:{register:t=>tools.set(t.name,t)}})
  const events=[];const session={id:base.sessionId,seq:0,snapshotEvents(){return Object.freeze([...events])}};let pending=false;const e={base,tools,sections};entries.push(e)
  return {agent:{id:base.sessionId,session,cancel(){},followup(){pending=true},async whenIdle(){if(!pending)return;pending=false;if(run)await run(e);events.push({seq:session.seq++,type:'assistant/message',data:{message:{content:[{type:'text',text:'复盘报告：进行中的迭代仍需独立测试。'}]}}})}},dispose:async()=>{}}
 }
 ctx.agents.resume=ctx.agents.create;plugin.apply(ctx,{stateDir:root})
 const server=createServer((req,res)=>void route.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api/plugins/grokbot`
 const api=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok);return r.json()}
 try{
  await api('/health')
  const denied=await fetch(base+'/external-reviews/p/decision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision:'accept'})});assert.equal(denied.status,403)
  const capability=(await readFile(join(root,'.codex-review-capability'),'utf8')).trim()
  const wrongThread=await fetch(base+'/external-reviews/p/decision',{method:'POST',headers:{'content-type':'application/json','x-codex-review-capability':capability},body:JSON.stringify({threadId:'other',decision:'accept'})});assert.equal(wrongThread.status,403)
  const notice={text:'规则通知：不要派工或验收',requestId:'notice-check',executionMode:'notice'}
  assert.equal((await api('/conversations/chief/chat',notice)).noticeOnly,true)
  assert.equal((await api('/conversations/chief/chat',notice)).noticeOnly,true)
  assert.equal(entries.length,0,'notice must never create a model session')
  const collision=await fetch(base+'/conversations/chief/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...notice,executionMode:'execute'})})
  assert.equal(collision.status,409,'same request cannot change into executable instructions')
  const notices=(await api('/conversations/chief')).messages.filter(m=>m.requestId==='notice-check')
  assert.equal(notices.length,2,'exactly one user notice and one deterministic receipt')
  await api('/bots/dev/chat',{text:'你好'})
  const dev=entries[0];assert.equal(JSON.parse(await dev.tools.get('team_retrospective').execute({action:'inspect',conversation_id:'p'})).ok,false)
  let published,chief
  run=async e=>{
   chief=e;const tool=e.tools.get('team_retrospective'),snap=JSON.parse(await tool.execute({action:'inspect',conversation_id:'p'}));assert.equal(snap.ok,true)
   const detail=JSON.parse(await tool.execute({action:'evidence',conversation_id:'p',fingerprint:snap.fingerprint,evidence_ids:['step:s']}));assert.equal(detail.ok,true);assert.equal(detail.evidence[0].accepted,false)
   published=JSON.parse(await tool.execute({action:'publish',conversation_id:'p',fingerprint:snap.fingerprint,summary:'此项目尚待验收，先改进测试标准',findings:[{kind:'problem',observation:'尚未验证',cause:'标准待补',evidence:['step:s']}],ratings:snap.roles.map(r=>({botId:r.botId,suggestion:'补齐验证',dimensions:r.dimensions.map(name=>({name,score:null,reason:'证据不足',evidence:[]}))})),actions:[{botId:'dev',trigger:'实现交付前',practice:'补齐边界用例',criterion:'边界验证且用户验收',evidence:['step:s']}]}));assert.equal(published.ok,true)
  }
  const reply=await api('/bots/chief/chat',{text:'复盘测试项目进展'});assert.match(reply.reply||reply.text||reply.outcome?.text||'',/复盘报告/);assert.ok(JSON.stringify(reply).includes(published.url));run=null
  run=async e=>{await e.tools.get('team_retrospective').execute({action:'inspect',conversation_id:'p'})};const reused=await api('/bots/chief/chat',{text:'再看一下复盘报告'});assert.ok(JSON.stringify(reused).includes(published.url));run=null
  const blocked=JSON.parse(await chief.tools.get('team_retrospective').execute({action:'publish',conversation_id:'p'}));assert.equal(blocked.ok,false);assert.match(blocked.error,/当前用户/)
  const page=await fetch(base.replace('/api/plugins/grokbot','')+published.url);assert.equal(page.status,200);assert.match(await page.text(),/角色成绩单/)
  assert.equal((await api('/retrospectives?conversationId=p')).reports.length,1)
  const state=await api('/state');assert.equal(state.bots.find(b=>b.id==='dev').rating.growth.reviews,1)
  const assembled=await hooks.get('system-prompt/assemble')({}, {sessionId:dev.base.sessionId},async()=>({sections:dev.sections}));assert.match(assembled.sections.find(s=>s.name==='grokbot:learning').text,/补齐边界用例/)
  const repeated=await hooks.get('system-prompt/assemble')({}, {sessionId:dev.base.sessionId},async()=>assembled);assert.equal(repeated.sections.filter(s=>s.name==='grokbot:learning').length,1)

  run=async e=>{
   let concluded=false
   const result=JSON.parse(await e.tools.get('team_project_lifecycle').execute({action:'archive',conversation_id:'p',expectedRevision:0,summary:'用户归档；本阶段未验收，保留历史'},{concludeTurn(){concluded=true}}));assert.equal(result.ok,true);assert.equal(concluded,true,'native successful completion, not cancellation')
   const history=await api('/conversations/chief');assert.equal(history.messages.filter(m=>m.requestId==='archive-check'&&m.role==='bot').length,1,'receipt visible before native completion')
   const gate=await hooks.get('agent/pre-step')({agent:{session:{id:e.base.sessionId}}},()=>({kind:'enter'}));assert.equal(gate.kind,'enter','native conclusion must not mark the turn blocked')
   throw Error('optional memory failed')
  }
  const archived=await api('/conversations/chief/chat',{text:'归档这个项目',requestId:'archive-check'});assert.match(archived.reply,/已归档/);assert.doesNotMatch(archived.reply,/失败/)
  const receipt=(await api('/conversations/chief')).messages.filter(m=>m.requestId==='archive-check'&&m.role==='bot');assert.equal(receipt.length,1)
  run=null
 }finally{for(const d of disposers.reverse())await d();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
})
