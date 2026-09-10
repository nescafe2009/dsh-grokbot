import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readLifecycle,transitionProject,admitProject,withActiveProject,acceptProjectStep,acceptedStep} from '../src/project-lifecycle.mjs'
import {enqueueJob,completeJob,scanInbox} from '../src/inbox.mjs'
import {savePlan,projectBoard,readPlan} from '../src/project-board.mjs'
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'lifecycle-'));try{await fn(root)}finally{await rm(root,{recursive:true,force:true})}}
const change=(root,action,expectedRevision,extra={})=>transitionProject(root,'g',{action,expectedRevision,summary:'用户明确操作',...extra})
test('legacy projects start active; archive persists, rejects work, restores paused and requires explicit resume',()=>fixture(async root=>{
 assert.equal((await readLifecycle(root,'g')).revision,0)
 await change(root,'archive',0)
 const archived=await readLifecycle(root,'g');assert.equal(archived.status,'archived');assert.equal(archived.epoch,1)
 await assert.rejects(admitProject(root,'g'),/archived/)
 await assert.rejects(change(root,'resume',1),/不允许/)
 await change(root,'restore',1);await assert.rejects(admitProject(root,'g'),/paused/)
 await change(root,'resume',2);const release=await admitProject(root,'g');release()
 assert.equal((await readLifecycle(root,'g')).history.length,3)
}))
test('concurrent stale transitions cannot silently overwrite each other',()=>fixture(async root=>{
 const result=await Promise.allSettled([change(root,'archive',0),change(root,'cancel',0)])
 assert.equal(result.filter(x=>x.status==='fulfilled').length,1)
 assert.match(result.find(x=>x.status==='rejected').reason.message,/版本/)
}))
test('pause closes admission while live operation drains; archive cannot claim completion while live',()=>fixture(async root=>{
 const release=await admitProject(root,'g')
 await change(root,'pause',0)
 await assert.rejects(change(root,'archive',1),/执行中/)
 await assert.rejects(admitProject(root,'g'),/paused/)
 release();release();await change(root,'archive',1)
}))
test('blockers require ownership and resolution; completion requires acceptance',()=>fixture(async root=>{
 await assert.rejects(change(root,'block',0),/负责人/)
 await change(root,'block',0,{blocker:{reason:'SDK 缺失',owner:'环境负责人',resolution:'SDK 构建成功'}})
 await assert.rejects(withActiveProject(root,'g',()=>{}),/blocked/)
 await change(root,'resume',1)
 await assert.rejects(change(root,'complete',2),/验收/)
 await transitionProject(root,'g',{action:'complete',expectedRevision:2,summary:'全部验收'},async()=>({allAccepted:true}))
 await change(root,'archive',3)
}))
test('replied does not release dependencies; explicit acceptance is tied to exact step contents',()=>fixture(async root=>{
 const inbox=join(root,'inbox'),job=await enqueueJob(inbox,{toBot:'dev',conversationId:'g',text:'implement'})
 await completeJob(job,'dev','member says done')
 const step={id:'one',title:'模块',botId:'dev',jobIds:[job.jobId],dependsOn:[]},second={id:'two',title:'联调',botId:'dev',jobIds:[],dependsOn:['one']}
 await savePlan(root,'g',[step,second],['dev'],[job])
 const opts={stateDir:root,inboxRoot:inbox,conversationId:'g',bots:[]}
 let board=await projectBoard(opts);assert.equal(board.rows[0].status,'awaiting_acceptance');assert.equal(board.rows[1].status,'blocked')
 await assert.rejects(acceptProjectStep(root,'g',{expectedRevision:0,stepId:'one',evidence:''},async()=>({step,ready:true})),/证据/)
 await acceptProjectStep(root,'g',{expectedRevision:0,stepId:'one',evidence:'用户核对测试报告与文件'},async()=>({step,ready:true}))
 board=await projectBoard(opts);assert.equal(board.rows[0].status,'done');assert.equal(board.rows[1].status,'planned')
 await savePlan(root,'g',[{...step,title:'扩大范围'},second],['dev'],[job])
 board=await projectBoard(opts);assert.equal(board.rows[0].status,'planned');assert.equal(board.rows[1].status,'blocked')
 await change(root,'archive',1)
 await assert.rejects(savePlan(root,'g',[step],['dev'],[job]),/archived/)
 assert.equal((await readPlan(root,'g')).steps.length,2)
}))
test('queue preserves epoch for stale-attempt rejection after archive and restoration',()=>fixture(async root=>{
 const inbox=join(root,'inbox');await enqueueJob(inbox,{conversationId:'g',toBot:'dev',text:'old',projectEpoch:3})
 assert.equal((await scanInbox(inbox))[0].projectEpoch,3)
}))
test('corrupt lifecycle fails closed instead of treating project as active',()=>fixture(async root=>{
 await change(root,'pause',0)
 await writeFile(join(root,'project-lifecycle','g.json'),'{}')
 await assert.rejects(admitProject(root,'g'),/损坏/)
}))

test('paused projects do not exhaust the queue scan limit and starve active projects',()=>fixture(async root=>{
 const inbox=join(root,'inbox')
 for(let i=0;i<3;i++)await enqueueJob(inbox,{conversationId:'paused',toBot:'dev',text:'held'})
 await enqueueJob(inbox,{conversationId:'active',toBot:'dev',text:'ready'})
 const jobs=await scanInbox(inbox,{limit:1,include:async job=>job.conversationId==='active'})
 assert.equal(jobs.length,1);assert.equal(jobs[0].conversationId,'active')
}))
test('conversational acceptance rejects work changed since handoff even when lifecycle revision is unchanged',()=>fixture(async root=>{
 const {deliveryFingerprint}=await import('../src/project-lifecycle.mjs')
 const step={id:'design',title:'v1',botId:'dev',dependsOn:[],jobIds:['j1']}
 const args={expectedRevision:0,stepId:'design',evidence:'用户通过 v1',expectedFingerprint:deliveryFingerprint(await readLifecycle(root,'g'),step),expectedEpoch:0}
 await assert.rejects(acceptProjectStep(root,'g',args,async()=>({step:{...step,title:'v2'},ready:true})),/版本已变化/)
 await assert.rejects(acceptProjectStep(root,'g',{...args,expectedEpoch:1},async()=>({step,ready:true})),/旧项目批次/)
 await acceptProjectStep(root,'g',args,async()=>({step,ready:true}))
 await assert.rejects(acceptProjectStep(root,'g',{...args,expectedRevision:1},async()=>({step,ready:true})),/无需重复/)
}))
test('review policy persists when omitted and final delivery cannot be delegated to chief',()=>fixture(async root=>{
 const plan=[{id:'build',title:'工程',botId:'dev',jobIds:[],dependsOn:[],reviewMode:'chief'},{id:'release',title:'发布验收',botId:'dev',jobIds:[],dependsOn:['build'],reviewMode:'user'}]
 await savePlan(root,'g',plan,['dev'],[])
 await savePlan(root,'g',plan.map(({reviewMode,...s})=>s),['dev'],[])
 assert.equal((await readPlan(root,'g')).steps[0].reviewMode,'chief')
 await assert.rejects(savePlan(root,'g',plan.map(s=>({...s,reviewMode:'chief'})),['dev'],[]),/最终交付/)
}))
