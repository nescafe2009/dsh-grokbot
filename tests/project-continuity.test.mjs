import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {assertArchiveRequest,CONTINUITY_RULES} from '../src/project-continuity.mjs'
import {transitionProject,readLifecycle,acceptProjectStep,acceptedStep} from '../src/project-lifecycle.mjs'

test('acceptance or chief bundled suggestion never becomes archive permission',()=>{
 for(const text of ['我只是说通过，没让你归档','通过','好的，现在功能正常了','同意','不要归档','为什么归档了','如果通过就归档','可以归档吗？','不应该自动归档'])assert.throws(()=>assertArchiveRequest(text),/验收通过/)
 for(const text of ['归档这个项目','请把当前项目封存','archive this project'])assert.doesNotThrow(()=>assertArchiveRequest(text))
 assert.match(CONTINUITY_RULES,/独立复测/)
})
test('new iteration preserves accepted baseline and team continuity without dispatching or reviving old epoch',async()=>{
 const root=await mkdtemp(join(tmpdir(),'continuity-'))
 try{
  const step={id:'s1',botId:'dev',title:'旧交付',dependsOn:[],jobIds:['old']}
  await acceptProjectStep(root,'room',{expectedRevision:0,stepId:'s1',evidence:'用户确认旧版'},async()=>({step,ready:true}))
  await transitionProject(root,'room',{action:'archive',expectedRevision:1,summary:'旧轮次归档'},async()=>({snapshot:{plan:{steps:[step]}}}))
  const old=await readLifecycle(root,'room')
  const next=await transitionProject(root,'room',{action:'iterate',expectedRevision:old.revision,summary:'按用户要求继续优化字体'},async()=>({snapshot:{plan:{steps:[step]}}}))
  assert.equal(next.status,'active');assert.equal(next.epoch,old.epoch+1);assert.equal(next.iteration,2);assert.ok(acceptedStep(next,step))
  assert.deepEqual(next.iterations[0].baseline.plan.steps,[step]);assert.equal(next.history.at(-1).action,'iterate')
  await assert.rejects(transitionProject(root,'room',{action:'iterate',expectedRevision:old.revision,summary:'重复请求'}),/版本/)
  await assert.rejects(transitionProject(root,'room',{action:'iterate',expectedRevision:next.revision,summary:'重复请求'}),/先 complete.*iterate/)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('append iteration work keeps old acceptance and requires new independent QA and user delivery',async()=>{
 const {savePlan,readPlan}=await import('../src/project-board.mjs')
 const root=await mkdtemp(join(tmpdir(),'iteration-plan-'))
 try{
  const old={id:'v1',title:'旧版交付',botId:'dev',dependsOn:[],jobIds:[],finalDelivery:true,reviewMode:'user'}
  await savePlan(root,'room',[old],['chief','dev','qa'],[],0)
  await acceptProjectStep(root,'room',{expectedRevision:0,stepId:'v1',evidence:'旧版用户通过'},async()=>({step:old,ready:true}))
  await transitionProject(root,'room',{action:'complete',expectedRevision:1,summary:'旧版完成'},async()=>({allAccepted:true}))
  const state=await transitionProject(root,'room',{action:'iterate',expectedRevision:2,summary:'字体优化'},async()=>({snapshot:{plan:await readPlan(root,'room')}}))
  const steps=[{...old,finalDelivery:false},{id:'ui',title:'UI复核',botId:'dev',dependsOn:['v1'],jobIds:[],reviewMode:'chief'},{id:'qa',title:'独立测试',botId:'qa',dependsOn:['ui'],jobIds:[],reviewMode:'chief'},{id:'v2',title:'本轮用户验收',botId:'chief',dependsOn:['v1','ui','qa'],jobIds:[],finalDelivery:true,reviewMode:'user'}]
  const result=await savePlan(root,'room',steps,['chief','dev','qa'],[],1)
  assert.ok(acceptedStep(state,result.steps[0]));assert.equal(acceptedStep(state,result.steps[3]),false)
  assert.equal(result.steps[2].botId,'qa');assert.equal(result.steps[3].reviewMode,'user')
 }finally{await rm(root,{recursive:true,force:true})}
})
