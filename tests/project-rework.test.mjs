import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {enqueueJob,completeJob} from '../src/inbox.mjs'
import {readPlan,savePlan,readProjectJobs,projectBoard} from '../src/project-board.mjs'
import {readLifecycle,acceptProjectStep,acceptedStep,deliveryFingerprint,stepFingerprint,stepGeneration} from '../src/project-lifecycle.mjs'
import {returnProjectStep,recordRetest,validateDispatch,jobMatchesStep} from '../src/project-rework.mjs'
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'rework-')),inbox=join(root,'inbox')
 const steps=[]
 for(const [id,deps] of [['core',[]],['ui',['core']],['other',[]]]){
  const job=await enqueueJob(inbox,{toBot:'dev',conversationId:'g',text:id});await completeJob(job,'dev','old delivery')
  steps.push({id,title:id,botId:'dev',dependsOn:deps,jobIds:[job.jobId]})
 }
 await savePlan(root,'g',steps,['dev','qa'],await readProjectJobs(inbox,'g'))
 const state=()=>readLifecycle(root,'g'),jobs=()=>readProjectJobs(inbox,'g')
 const inspect=async()=>({steps,members:['dev','qa'],jobs:await jobs()})
 const open=async(id='core')=>returnProjectStep(root,'g',{stepId:id,expectedRevision:(await state()).revision,expectedFingerprint:deliveryFingerprint(await state(),steps.find(s=>s.id===id)),reason:'碰撞错误',evidence:'case-17 未通过',criteria:'case-17 和回归用例通过',testerBotId:'qa',actor:'chief'},inspect)
 const dispatch=async(phase,id='core',finish=true)=>{
  const s=await state(),step=steps.find(s=>s.id===id),toBot=phase==='retest'?'qa':'dev'
  validateDispatch(s,step,steps,await jobs(),{phase,toBot})
  const job=await enqueueJob(inbox,{toBot,conversationId:'g',text:phase,projectStep:{id,fingerprint:stepFingerprint({...step,jobIds:[]}),generation:stepGeneration(s,id),phase}})
  if(finish)await completeJob(job,toBot,'new delivery')
  return job
 }
 const result=async(job,outcome)=>recordRetest(root,'g',{stepId:'core',expectedRevision:(await state()).revision,generation:stepGeneration(await state(),'core'),testJobId:job.jobId,result:outcome,evidence:'实际回归报告',actor:'chief'},inspect)
 const accept=async(id)=>{const s=await state(),step=steps.find(x=>x.id===id);return acceptProjectStep(root,'g',{expectedRevision:s.revision,stepId:id,evidence:'核实通过',expectedFingerprint:deliveryFingerprint(s,step)},async()=>({step,ready:true}))}
 const board=()=>projectBoard({stateDir:root,inboxRoot:inbox,conversationId:'g',bots:[]})
 try{await fn({root,inbox,steps,state,jobs,inspect,open,dispatch,result,accept,board})}finally{await rm(root,{recursive:true,force:true})}
}
test('return invalidates only affected branch and old acceptance never resurrects',()=>fixture(async f=>{
 await f.accept('core');await f.accept('ui');await f.accept('other')
 const s=await f.open();assert.equal(s.stepGenerations.core,1);assert.equal(s.stepGenerations.ui,1)
 assert.equal(acceptedStep(s,f.steps[2],f.steps),true);assert.equal(acceptedStep(s,f.steps[1],f.steps),false)
 assert.ok(s.history.at(-1).previousReviews.ui)
 const board=await f.board();assert.equal(board.rows.find(r=>r.id==='core').status,'rework_required');assert.equal(board.rows.find(r=>r.id==='ui').status,'blocked')
 await f.dispatch('repair');const retest=await f.dispatch('retest');await f.result(retest,'passed');await f.accept('core')
 assert.equal(acceptedStep(await f.state(),f.steps[1],f.steps),false,'dependent acceptance does not revive after upstream recovers')
 assert.equal((await f.board()).rows.find(r=>r.id==='ui').status,'planned','old downstream delivery cannot masquerade as current')
}))
test('repair delivery cannot pass acceptance without distinct retest and recorded result',()=>fixture(async f=>{
 await f.open();await assert.rejects(f.dispatch('retest'),/修复已交付/)
 await f.dispatch('repair');assert.equal((await f.board()).rows.find(r=>r.id==='core').status,'awaiting_retest')
 await assert.rejects(f.accept('core'),/复测/)
 await assert.rejects(f.dispatch('repair'),/重复修复/)
 const retest=await f.dispatch('retest');assert.equal((await f.board()).rows.find(r=>r.id==='core').status,'retest_review')
 await assert.rejects(f.accept('core'),/复测/)
 await f.result(retest,'passed');assert.equal((await f.board()).rows.find(r=>r.id==='core').status,'awaiting_acceptance')
 await f.accept('core');assert.equal((await f.board()).rows.find(r=>r.id==='core').status,'done')
}))
test('failed retest opens next cycle, rejects old results and persists evidence',()=>fixture(async f=>{
 await f.open();await f.dispatch('repair');const old=await f.dispatch('retest');const s=await f.result(old,'failed')
 assert.equal(s.reworks.core.cycle,2);assert.equal(s.reworks.core.phase,'repair');assert.equal(s.stepGenerations.core,2)
 assert.ok(s.history.some(h=>h.action==='retest'&&h.result==='failed'&&h.testJobId===old.jobId))
 await assert.rejects(f.result(old,'passed'),/当前轮次/)
 await f.dispatch('repair');const fresh=await f.dispatch('retest');await f.result(fresh,'passed')
 assert.equal((await readLifecycle(f.root,'g')).reworks.core.testJobId,fresh.jobId)
}))
test('stale queued and late-running jobs cannot count after return; unrelated branches retain eligibility',()=>fixture(async f=>{
 const state0=await f.state(),step=f.steps[0],old={projectStep:{id:'core',fingerprint:stepFingerprint({...step,jobIds:[]}),generation:0}}
 assert.equal(jobMatchesStep(state0,step,f.steps,old),true)
 const state=await f.open();assert.equal(jobMatchesStep(state,step,f.steps,old),false)
 assert.equal(jobMatchesStep(state,step,f.steps,{jobId:step.jobIds[0]}),false)
 assert.throws(()=>validateDispatch(state,step,f.steps,[],{phase:'normal',toBot:'dev'}),/退回/)
 assert.throws(()=>validateDispatch(state,f.steps[1],f.steps,[],{toBot:'dev'}),/前置/)
 assert.doesNotThrow(()=>validateDispatch(state,f.steps[2],f.steps,[],{toBot:'dev'}))
}))
test('concurrent returns have one winner and active rework scope cannot be erased',()=>fixture(async f=>{
 const outcomes=await Promise.allSettled([f.open(),f.open()]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1)
 await assert.rejects(f.open(),/已有返工/)
 await assert.rejects(savePlan(f.root,'g',f.steps.slice(1),['dev','qa'],await f.jobs()),/返工未闭环/)
 await f.dispatch('repair','core',false)
 await assert.rejects(f.dispatch('repair'),/已有排队/)
}))
test('plan edits use revision checks and retain history, dependency acceptance is bound to upstream version',()=>fixture(async f=>{
 const before=await readPlan(f.root,'g');await f.accept('core');await f.accept('ui')
 const edited=f.steps.map(s=>s.id==='core'?{...s,title:'修订核心范围'}:s)
 const changes=await Promise.allSettled([savePlan(f.root,'g',edited,['dev','qa'],await f.jobs(),before.revision),savePlan(f.root,'g',edited,['dev','qa'],await f.jobs(),before.revision)])
 assert.equal(changes.filter(r=>r.status==='fulfilled').length,1)
 const after=await readPlan(f.root,'g');assert.ok(after.history.some(h=>h.steps[0]?.title==='core'))
 assert.equal(after.steps[1].scopeVersion,1,'scope changes also invalidate dependent execution evidence')
 assert.equal((await f.board()).rows.find(r=>r.id==='core').status,'planned')
 const core=after.steps[0],state=await f.state()
 await acceptProjectStep(f.root,'g',{expectedRevision:state.revision,stepId:'core',evidence:'新版本检查通过'},async()=>({step:core,ready:true}))
 assert.equal(acceptedStep(await f.state(),after.steps[1],after.steps),false,'downstream must revalidate against changed upstream')
 const restored=await savePlan(f.root,'g',f.steps,['dev','qa'],await f.jobs(),after.revision)
 assert.equal(restored.steps[0].scopeVersion,2,'restoring a title does not resurrect the old scope version')
}))
test('explicit rework revision changes staffing and invalidates earlier attempts without discarding their history',()=>fixture(async f=>{
 await f.open();const old=await f.dispatch('repair','core',false)
 const s=await f.state()
 const revised=await returnProjectStep(f.root,'g',{action:'revise',stepId:'core',expectedRevision:s.revision,expectedFingerprint:deliveryFingerprint(s,f.steps[0]),reason:'重新分配核验人员',evidence:'开发者改由 QA 协助修复',criteria:'补充回归标准',ownerBotId:'qa',testerBotId:'dev',actor:'chief'},f.inspect)
 assert.equal(revised.reworks.core.ownerBotId,'qa');assert.equal(revised.reworks.core.cycle,2)
 assert.equal(jobMatchesStep(revised,f.steps[0],f.steps,old),false)
 assert.ok(revised.history.at(-1).previousReworks.core)
 assert.doesNotThrow(()=>validateDispatch(revised,f.steps[0],f.steps,[],{phase:'repair',toBot:'qa'}))
}))
test('new review request covers repaired artifact and retest report and supersedes the old round',()=>fixture(async f=>{
 const {prepareHandoff,flushHandoff,reviewRequest}=await import('../src/project-handoff.mjs')
 const {writeFile}=await import('node:fs/promises')
 const notify=async()=>{const b=await f.board();return prepareHandoff(f.root,'g',{name:'项目',rows:b.rows,epoch:b.lifecycle.epoch,summary:'核实交付',originConversationId:'chief'})}
 let handoff=await notify();const old=handoff.requests.find(r=>r.stepId==='core').requestId
 await flushHandoff(f.root,'g',async()=>{})
 await f.open();await notify();await assert.rejects(reviewRequest(f.root,'g',old),/有效/)
 const repair=await f.dispatch('repair');await writeFile(join(repair.dir,'checkpoint.json'),JSON.stringify({files:['fixed-design.md']}))
 const retest=await f.dispatch('retest');await writeFile(join(retest.dir,'checkpoint.json'),JSON.stringify({files:['retest-report.md']}))
 await f.result(retest,'passed');handoff=await notify()
 const fresh=handoff.requests.find(r=>r.stepId==='core'&&!r.superseded)
 assert.notEqual(fresh.requestId,old);assert.match(fresh.text,/fixed-design.md/);assert.match(fresh.text,/retest-report.md/)
}))
test('saving explicit default user review after acceptance preserves scope, dependency approval and queued jobs',()=>fixture(async f=>{
 await f.accept('core')
 const state=await f.state(),before=await readPlan(f.root,'g')
 const queued=await enqueueJob(f.inbox,{toBot:'dev',conversationId:'g',text:'UI',projectStep:{id:'ui',fingerprint:stepFingerprint({...f.steps[1],jobIds:[]}),generation:0,phase:'normal'}})
 const proposal=before.steps.map(s=>({...s,reviewMode:'user',jobIds:s.id==='ui'?[...s.jobIds,queued.jobId]:s.jobIds}))
 const plan=await savePlan(f.root,'g',proposal,['dev','qa'],await f.jobs(),before.revision)
 assert.equal(acceptedStep(state,plan.steps[0],plan.steps),true)
 assert.equal(plan.steps[0].scopeVersion,undefined)
 assert.equal(plan.steps[1].scopeVersion,undefined)
 assert.equal(jobMatchesStep(state,plan.steps[1],plan.steps,queued),true)
 assert.equal((await f.board()).rows.find(r=>r.id==='core').status,'done')
 const original=deliveryFingerprint(state,plan.steps[0])
 await savePlan(f.root,'g',plan.steps.map(s=>({...s,reviewMode:'user'})),['dev','qa'],await f.jobs(),plan.revision)
 assert.equal(deliveryFingerprint(await f.state(),(await readPlan(f.root,'g')).steps[0]),original)
}))
