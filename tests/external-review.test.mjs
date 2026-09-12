import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {configureExternalReviewer,syncExternalReviews,decideExternalReview} from '../src/external-review.mjs'
import {acceptProjectStep,readLifecycle,acceptedStep,reviewModeOf} from '../src/project-lifecycle.mjs'
import {projectBoard} from '../src/project-board.mjs'
import {prepareHandoff} from '../src/project-handoff.mjs'
test('delegated aggregate creates one durable Codex request without fake job; decision bound to version',async()=>{
 const root=await mkdtemp(join(tmpdir(),'external-review-')),inbox=join(root,'inbox')
 const steps=[{id:'work',title:'实现',botId:'dev',dependsOn:[],jobIds:['j'],reviewMode:'chief'},{id:'final',title:'交付',botId:'chief',dependsOn:['work'],jobIds:[],reviewMode:'user',finalDelivery:true}]
 try{
  await mkdir(join(root,'project-plans'),{recursive:true});await writeFile(join(root,'project-plans','p.json'),JSON.stringify({steps,revision:1}))
  await mkdir(join(inbox,'j'),{recursive:true});await writeFile(join(inbox,'queue.jsonl'),JSON.stringify({jobId:'j',toBot:'dev',conversationId:'p'})+'\n');await writeFile(join(inbox,'j','status.json'),JSON.stringify({status:'replied'}))
  await mkdir(join(root,'workspace'));await writeFile(join(root,'workspace','delivery.md'),'v1');await writeFile(join(inbox,'j','checkpoint.json'),JSON.stringify({files:['delivery.md']}))
  await acceptProjectStep(root,'p',{expectedRevision:0,stepId:'work',evidence:'实现证据',actor:'chief'},async()=>({step:steps[0],ready:true}))
  const board=()=>projectBoard({stateDir:root,inboxRoot:inbox,conversationId:'p',bots:[]})
  assert.equal((await board()).rows.find(r=>r.id==='final').status,'planned')
  await configureExternalReviewer(root,'p','thread-1');let b=await board();assert.equal(b.rows.find(r=>r.id==='final').status,'awaiting_acceptance');assert.equal(b.rows.find(r=>r.id==='final').reviewMode,'codex')
  const queue=JSON.stringify({jobId:'j',toBot:'dev',conversationId:'p'})+'\n'
  await writeFile(join(inbox,'queue.jsonl'),queue+JSON.stringify({jobId:'extra',toBot:'dev',conversationId:'p'})+'\n')
  const busy=await board();assert.equal(busy.rows.find(r=>r.id==='final').status,'blocked');assert.equal((await syncExternalReviews(root,'p',busy)).length,0,'unplanned active work blocks aggregate review')
  await writeFile(join(inbox,'queue.jsonl'),queue);b=await board()
  let requests=await syncExternalReviews(root,'p',b);assert.equal(requests.length,1);assert.equal((await syncExternalReviews(root,'p',b)).length,1)
  const legacy=await prepareHandoff(root,'p',{name:'项目',rows:b.rows,epoch:b.lifecycle.epoch,originConversationId:'chief'});assert.equal(legacy.requests.length,0,'do not ask user in DSH')
  await assert.rejects(decideExternalReview(root,inbox,'another',{requestId:requests[0].id,decision:'accept',evidence:'错误项目'}),/不存在/)
  await writeFile(join(root,'workspace','delivery.md'),'v2')
  await assert.rejects(decideExternalReview(root,inbox,'p',{requestId:requests[0].id,decision:'accept',evidence:'旧文件版本'}),/失效/)
  requests=(await syncExternalReviews(root,'p',await board())).filter(r=>r.status==='pending');assert.equal(requests.length,1)
  await decideExternalReview(root,inbox,'p',{requestId:requests[0].id,decision:'accept',evidence:'Codex独立核验'})
  assert.ok(acceptedStep(await readLifecycle(root,'p'),steps[1],steps));assert.equal((await board()).rows.find(r=>r.id==='final').status,'done')
  await assert.rejects(decideExternalReview(root,inbox,'p',{requestId:requests[0].id,decision:'accept',evidence:'重复'}),/已处理|失效/)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('external rejection formally returns only the defective branch and invalidates final acceptance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'external-return-')),inbox=join(root,'inbox')
 const steps=[{id:'work',title:'成本报告',botId:'dev',dependsOn:[],jobIds:['j'],reviewMode:'chief'},{id:'final',title:'交付',botId:'chief',dependsOn:['work'],jobIds:[],finalDelivery:true}]
 try{
  await mkdir(join(root,'project-plans'),{recursive:true});await writeFile(join(root,'project-plans','p.json'),JSON.stringify({steps,revision:1}))
  await writeFile(join(root,'crew.json'),JSON.stringify({conversations:[{id:'p',memberBotIds:['chief','dev','qa']}]}))
  await mkdir(join(inbox,'j'),{recursive:true});await writeFile(join(inbox,'queue.jsonl'),JSON.stringify({jobId:'j',toBot:'dev',conversationId:'p'})+'\n');await writeFile(join(inbox,'j','status.json'),JSON.stringify({status:'replied'}))
  await acceptProjectStep(root,'p',{expectedRevision:0,stepId:'work',evidence:'内部核验',actor:'chief'},async()=>({step:steps[0],ready:true}));await configureExternalReviewer(root,'p','thread')
  const board=()=>projectBoard({stateDir:root,inboxRoot:inbox,conversationId:'p',bots:[]})
  const req=(await syncExternalReviews(root,'p',await board()))[0]
  await assert.rejects(decideExternalReview(root,inbox,'p',{requestId:req.id,decision:'reject',evidence:'数据不完整'}),/问题阶段/)
  const r=await decideExternalReview(root,inbox,'p',{requestId:req.id,decision:'reject',returnStepId:'work',testerBotId:'qa',criteria:'所有记录与源数据一致',evidence:'数据不完整'})
  assert.equal(r.status,'rejected');const b=await board();assert.equal(b.rows.find(r=>r.id==='work').status,'rework_required');assert.equal(b.rows.find(r=>r.id==='final').status,'blocked');assert.equal(b.lifecycle.reworks.work.testerBotId,'qa')
  assert.equal((await syncExternalReviews(root,'p',b)).filter(r=>r.status==='pending').length,0)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('delegation routes user decision gates to Codex while retaining internal technical reviews',()=>{const state={externalReviewer:{kind:'codex',threadId:'t'}};assert.equal(reviewModeOf(state,{reviewMode:'user'}),'codex');assert.equal(reviewModeOf(state,{reviewMode:'chief'}),'chief');assert.equal(reviewModeOf({}, {reviewMode:'user'}),'user')})
