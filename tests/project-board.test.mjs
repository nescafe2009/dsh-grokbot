import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {enqueueJob,failJob,completeJob,claimJob} from '../src/inbox.mjs'
import {savePlan,projectBoard} from '../src/project-board.mjs'
import {createTask,startRun,endRun} from '../src/tasks.mjs'
import vm from 'node:vm'

test('effective Codex reviewer round-trips without changing stored policy or delivery identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'board-reviewer-'))
 try{
  const step={id:'final',title:'deliver',botId:'chief',dependsOn:[],jobIds:[],finalDelivery:true}
  const first=await savePlan(root,'g',[step],['chief'],[])
  await assert.rejects(savePlan(root,'g',[{...step,reviewMode:'codex'}],['chief'],[]),/宿主已配置/)
  await mkdir(join(root,'project-lifecycle'),{recursive:true})
  await writeFile(join(root,'project-lifecycle','g.json'),JSON.stringify({version:1,conversationId:'g',status:'active',epoch:0,revision:0,history:[],externalReviewer:{kind:'codex',threadId:'test'},reviews:{}}))
  const board=await projectBoard({stateDir:root,inboxRoot:join(root,'inbox'),conversationId:'g',bots:[]})
  assert.equal(board.rows[0].reviewMode,'codex')
  const saved=await savePlan(root,'g',board.rows,['chief'],[],first.revision)
  assert.deepEqual(saved.steps,first.steps)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('project board: group isolation, real lifecycle, dependencies, retry recovery, approvals and stale running',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gk-board-')),inboxRoot=join(root,'inbox')
 const opts={stateDir:root,inboxRoot,conversationId:'g',bots:[]}
 try{
 const old=await enqueueJob(inboxRoot,{jobId:'old',toBot:'a',conversationId:'g',text:'architecture'});await failJob(old,'a','quota')
 await enqueueJob(inboxRoot,{jobId:'private',toBot:'b',conversationId:'private',text:'PRIVATE'})
 const next=await enqueueJob(inboxRoot,{jobId:'next',toBot:'a',conversationId:'g',text:'retry'});await claimJob(next,'a')
 const steps=[{id:'design',title:'架构设计',botId:'a',dependsOn:[],jobIds:['old']},{id:'build',title:'开发',botId:'b',dependsOn:['design'],jobIds:[]}]
 await savePlan(root,'g',steps,['a','b'],[old,next]);let b=await projectBoard(opts)
 assert.equal(b.rows.find(r=>r.id==='design').status,'failed');assert.equal(b.rows.find(r=>r.id==='build').status,'blocked');assert.equal(b.rows.find(r=>r.id==='next').status,'unknown');assert.ok(!JSON.stringify(b).includes('PRIVATE'))
 steps[0].jobIds.push('next');await savePlan(root,'g',steps,['a','b'],[old,next]);b=await projectBoard({...opts,runningIds:['next'],approvals:[{botId:'a',jobId:'next',stage:'user',reviewReason:'需要你确认'}]});assert.equal(b.rows.find(r=>r.id==='design').status,'approval')
 await completeJob(next,'a','review done');b=await projectBoard(opts);assert.equal(b.rows.find(r=>r.id==='design').status,'awaiting_acceptance');assert.equal(b.rows.find(r=>r.id==='build').status,'blocked');assert.equal(b.rows.filter(r=>['old','next'].includes(r.id)).length,0)
 const t=await createTask(root,{conversationId:'g',ownerBotId:'a',title:'另一次执行'});const run=await startRun(root,t.id,{botId:'a'});b=await projectBoard(opts);assert.equal(b.rows.find(r=>r.id===t.id).status,'unknown');await endRun(root,t.id,run.run.id,'cancelled');b=await projectBoard(opts);assert.equal(b.rows.find(r=>r.id===t.id).status,'cancelled')
 await assert.rejects(savePlan(root,'g',[{...steps[0],dependsOn:['build']},steps[1]],['a','b'],[old,next]),/成环/)
 await assert.rejects(savePlan(root,'g',[{...steps[0],botId:'outsider'}],['a','b'],[old,next]),/负责人/)
 await assert.rejects(savePlan(root,'g',[{...steps[0],jobIds:['private']}],['a','b'],[old,next]),/关联任务/)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('group default responder is chief; explicit member mentions still work',async()=>{
 const source=await readFile(new URL('../src/index.mjs',import.meta.url),'utf8')
 const bots=[{id:'dev',name:'工程师'},{id:'chief',name:'幕僚长'}]
 const ctx={crewState:{crew:{bots,routing:{default:'dev'}}},eligibleBots:c=>bots.filter(b=>c.memberBotIds.includes(b.id))}
 vm.runInNewContext(source.slice(source.indexOf('  function pickResponder('),source.indexOf('  const HANDOFF_LINE_RE'))+'globalThis.pick=pickResponder',ctx)
 assert.equal(ctx.pick({memberBotIds:['dev','chief']},'下一步呢').id,'chief')
 assert.equal(ctx.pick({memberBotIds:['dev','chief']},'@工程师 说明一下').id,'dev')
 assert.equal(ctx.pick({memberBotIds:['dev']},'你好').id,'dev')
})


test('board exposes durable checkpoint and hides stale progress after execution ends',async()=>{
 const root=await mkdtemp(join(tmpdir(),'board-progress-')),inboxRoot=join(root,'inbox')
 try{
  const job=await enqueueJob(inboxRoot,{toBot:'a',conversationId:'g',text:'codec'});await claimJob(job,'a')
  await writeFile(join(job.dir,'checkpoint.json'),JSON.stringify({completed:'codec',files:['codec.cpp'],validation:'passed',remaining:'transport',blockers:'',verified:false}))
  await writeFile(join(job.dir,'progress.json'),JSON.stringify({observation:'awaiting-tool',elapsedMs:3600000}))
  const opts={stateDir:root,inboxRoot,conversationId:'g',bots:[]}
  let board=await projectBoard({...opts,runningIds:[job.jobId]});assert.equal(board.rows[0].checkpoint.remaining,'transport');assert.equal(board.rows[0].progress.observation,'awaiting-tool')
  await failJob(job,'a','provider error');board=await projectBoard(opts);assert.equal(board.rows[0].progress,null);assert.equal(board.rows[0].checkpoint.completed,'codec')
 }finally{await rm(root,{recursive:true,force:true})}
})
