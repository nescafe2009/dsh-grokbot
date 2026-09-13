import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import plugin from '../lib/index.mjs'

test('real plugin routes and native prompt hook share roles across cached DM, group, team creation and background jobs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'role-integration-'))
 await mkdir(join(root,'workspace'))
 await writeFile(join(root,'crew.json'),JSON.stringify({bots:[{id:'chief',name:'幕僚长'},{id:'lin',name:'林一舟',title:'架构师 / 技术负责人',persona:''}]}))
 const disposers=[],hooks=new Map(),created=[];let route
 const ctx={effect(fn){const d=fn();if(typeof d==='function')disposers.push(d)},on(name,fn){hooks.set(name,fn);return()=>{}},logger:{info(){},warn(){},error(){}},webServer:{register(r){route=r;return()=>{}}},agentDefaultModel:{currentSelection:()=>null},llm:{listProviders:async()=>[],listModels:async()=>[]},agents:{}}
 ctx.agents.create=async base=>{
  const sections=[],tools=new Map();await base.setup({systemPrompt:{section:s=>sections.push(s)},tools:{register:t=>tools.set(t.name,t)}})
  const session={id:base.sessionId,seq:0,events:[]};let pending=false
  const entry={base,sections,tools,assembled:null};created.push(entry)
  return {agent:{id:base.sessionId,session,cancel(){},followup(){pending=true},async whenIdle(){if(!pending)return;pending=false
   entry.assembled=await hooks.get('system-prompt/assemble')({}, {sessionId:base.sessionId},async()=>({sections}))
   session.events.push({seq:session.seq++,type:'assistant/message',data:{message:{content:[{type:'text',text:'fixture reply'}]}}})
  }},dispose:async()=>{}}
 }
 ctx.agents.resume=ctx.agents.create
 plugin.apply(ctx,{stateDir:root})
 const server=createServer((req,res)=>void route.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const base=`http://127.0.0.1:${server.address().port}/api/plugins/grokbot`
 async function api(path,body,method=body?'POST':'GET') {const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result}
 const identity=e=>e.assembled.sections.find(s=>s.name==='grokbot:identity').text
 try {
  await api('/health')
  await api('/bots/lin/chat',{text:'你的角色是什么'})
  const dm=created.find(e=>e.assembled?.sections.some(s=>s.text.includes('姓名：林一舟')))
  assert.match(identity(dm),/接口契约/)
  await api('/bots/lin',{name:'林顾问',title:'测试工程师'},'PATCH')
  await api('/bots/lin/chat',{text:'现在你的职责是什么'})
  assert.match(identity(dm),/姓名：林顾问/);assert.match(identity(dm),/逐项验收证据/)
  assert.equal(dm.assembled.sections.filter(s=>s.name==='grokbot:identity').length,1)
  const preset=await api('/bots',{templateId:'architect',name:'新架构师'})
  assert.equal(preset.bot.roleTemplate,'architect')
  assert.equal(JSON.parse(await readFile(join(root,'bots',preset.bot.id,'setup.json'),'utf8')).stage,'done')
  const history=await readFile(join(root,'bots',preset.bot.id,'dm-transcript.jsonl'),'utf8');assert.match(history,/新架构师/);assert.doesNotMatch(history,/林一舟/)
  await api('/bots/chief/chat',{text:'你好'})
  const chief=created.find(e=>e.sections.some(s=>s.text.includes('姓名：幕僚长')))
  const adjusted=JSON.parse(await chief.tools.get('team_update_member').execute({member_id:'lin',role:'架构师 / 技术负责人',persona:'接口变更先说明兼容性'}))
  assert.equal(adjusted.ok,true)
  await api('/bots/lin/chat',{text:'确认职责'})
  assert.match(identity(dm),/接口契约/);assert.match(identity(dm),/接口变更先说明兼容性/)
  assert.equal(await dm.tools.get('team_update_member').execute({member_id:'chief',name:'越权修改'}),'Only chief can update members')
  const blank=await api('/bots',{templateId:'blank'})
  await api(`/conversations/${blank.bot.id}/chat`,{text:'架构师 / 技术负责人'})
  assert.equal(JSON.parse(await readFile(join(root,'bots',blank.bot.id,'setup.json'),'utf8')).stage,'await-name')
  assert.equal((await api(`/bots/${blank.bot.id}`)).bot.roleTemplate,'architect')
  const member=JSON.parse(await chief.tools.get('team_create_member').execute({name:'鸿蒙成员',role:'鸿蒙开发工程师'}))
  assert.equal(member.ok,true)
  const state=await api('/state');assert.equal(state.bots.find(b=>b.id===member.id).roleTemplate,'harmony')
  const project=JSON.parse(await chief.tools.get('team_setup_project').execute({group_name:'角色验证群',members:[{name:'架构甲',role:'架构师',templateId:'architect',persona:'只设计接口'},{name:'测试甲',role:'测试工程师',templateId:'qa'}]}))
  assert.ok(project.group,JSON.stringify(project))
  const again=JSON.parse(await chief.tools.get('team_create_group').execute({name:'角色验证群',members:['架构甲','测试甲','鸿蒙成员']}))
  assert.equal(again.id,project.group.id);assert.equal(again.existing,true)
  const setupRequest={group_name:'角色验证群',members:[{name:'架构甲',role:'架构师',task:'准备接口说明',deliverable:'接口说明',acceptance:'包含输入输出'}]}
  const firstDispatch=JSON.parse(await chief.tools.get('team_setup_project').execute(setupRequest))
  const secondDispatch=JSON.parse(await chief.tools.get('team_setup_project').execute(setupRequest))
  assert.equal(firstDispatch.ok,true,JSON.stringify(firstDispatch));assert.equal(secondDispatch.ok,true,JSON.stringify(secondDispatch))
  assert.equal(firstDispatch.tasks[0].jobId,secondDispatch.tasks[0].jobId)
  const queue=(await readFile(join(root,'inbox/queue.jsonl'),'utf8')).trim().split('\n').map(l=>JSON.parse(l))
  assert.equal(queue.filter(j=>j.jobId===firstDispatch.tasks[0].jobId).length,1)
  assert.equal((await api('/state')).bots.filter(b=>b.name==='架构甲').length,1)

  await api(`/conversations/${project.group.id}/chat`,{text:'@架构甲 你的角色是什么'})
  const group=created.find(e=>e.assembled?.sections.some(s=>s.text.includes('姓名：架构甲')))
  assert.match(identity(group),/接口契约/);assert.match(identity(group),/只设计接口/)
  await api('/inbox',{toBot:member.id,text:'报告你的职责，不修改文件'})
  const deadline=Date.now()+5000
  let job
  while(Date.now()<deadline){job=created.find(e=>e.assembled?.sections.some(s=>s.text.includes('姓名：鸿蒙成员')));if(job)break;await new Promise(r=>setTimeout(r,20))}
  assert.ok(job,'background job assembled');assert.match(identity(job),/HarmonyOS Next/)
  const foreign=await hooks.get('system-prompt/assemble')({}, {sessionId:'foreign'},async()=>({sections:[{name:'native',text:'untouched'}]}));assert.deepEqual(foreign.sections,[{name:'native',text:'untouched'}])
 } finally {
  for(const d of disposers.reverse())await d()
  server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})
 }
})
