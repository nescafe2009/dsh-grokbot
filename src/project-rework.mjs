import {currentProjectEvidence} from './project-evidence.mjs'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {atomicWriteFile} from './inbox.mjs'
import {readLifecycle,projectLock,stepFingerprint,deliveryFingerprint,stepGeneration,acceptedStep} from './project-lifecycle.mjs'

export function affectedSteps(steps,id){
 const affected=new Set([id]);let changed=true
 while(changed){changed=false;for(const step of steps)if(!affected.has(step.id)&&step.dependsOn.some(d=>affected.has(d))){affected.add(step.id);changed=true}}
 return [...affected]
}
export function currentStepJobs(state,step,jobs){return jobs.filter(j=>(j.projectStep?.id===step.id||step.jobIds.includes(j.jobId))&&(j.projectStep?.generation||0)===stepGeneration(state,step.id)&&(j.projectStep?j.projectStep.fingerprint===stepFingerprint({...step,jobIds:[]}):!step.scopeVersion))}
const terminal=j=>j&&['replied','failed','cancelled'].includes(j.record.status)
export function reworkView(state,step,jobs){
 const work=state.reworks?.[step.id];if(!work)return null
 const current=currentStepJobs(state,step,jobs),repair=current.filter(j=>j.projectStep?.phase==='repair').at(-1),retest=current.filter(j=>j.projectStep?.phase==='retest').at(-1)
 let status='rework_required'
 if(work.phase==='passed'&&(!work.scopeFingerprint||work.scopeFingerprint===stepFingerprint({...step,jobIds:[]})))status='awaiting_acceptance'
 else if(retest)status=!terminal(retest)?'retesting':retest.record.status==='replied'?'retest_review':'retest_failed'
 else if(repair)status=!terminal(repair)?'reworking':repair.record.status==='replied'?'awaiting_retest':'rework_failed'
 return {...work,status,repairJobId:repair?.jobId||null,testJobId:retest?.jobId||null}
}
export function validateDispatch(state,step,steps,jobs,{phase='normal',toBot}){
 if(!step.dependsOn.every(id=>acceptedStep(state,steps.find(s=>s.id===id),steps)))throw Error('前置工作包尚未验收，不能派发下游任务')
 if(step.finalDelivery&&steps.some(s=>s.id!==step.id&&!acceptedStep(state,s,steps)))throw Error('最终质量验收尚有必交付阶段未验收')
 if(acceptedStep(state,step,steps))throw Error('工作包已验收；发现缺陷请先退回返工')
 if(currentProjectEvidence(state,step,steps,jobs))throw Error('已有成果已登记待审，不应重复派工；有缺陷请退回返工')
 const work=state.reworks?.[step.id],current=currentStepJobs(state,step,jobs)
 if(work){
  if(work.scopeFingerprint&&work.scopeFingerprint!==stepFingerprint({...step,jobIds:[]}))throw Error('阶段范围已变化，请用 action=revise 调整返工方案再派发')
  if(!['repair','retest'].includes(phase))throw Error('阶段已退回，必须明确派发 repair 修复或 retest 复测')
  if(work.phase==='passed')throw Error('复测已通过，请先完成阶段验收')
  const repair=current.filter(j=>j.projectStep?.phase==='repair').at(-1),retest=current.filter(j=>j.projectStep?.phase==='retest').at(-1)
  if(phase==='repair'&&(toBot!==work.ownerBotId||repair?.record.status==='replied'||retest))throw Error('修复负责人不符或本轮已进入复测，不得重复修复；复测不通过后开启新一轮')
  if(phase==='retest'&&(toBot!==work.testerBotId||repair?.record.status!=='replied'||retest?.record.status==='replied'))throw Error('复测须由指定核验人执行，且本轮修复已交付；已交付的复测需先记录结论')
 }else {if(phase!=='normal'||toBot!==step.botId)throw Error('工作包负责人或任务类型不符');if(current.some(j=>j.record.status==='replied'))throw Error('本阶段已交付；需要新工作请先退回返工，不能用重复派发替换待审成果')}
 if(jobs.some(j=>(j.projectStep?.id===step.id||step.jobIds.includes(j.jobId))&&(j.record.status==='claimed'||(current.includes(j)&&(!j.record.status||j.record.status==='queued')))))throw Error('该工作包已有排队或执行任务，不能重复派发')
}
export function jobMatchesStep(state,step,steps,job){return Boolean(step&&(job.projectEpoch||0)===(state.epoch||0)&&(job.projectStep?.generation||0)===stepGeneration(state,step.id)&&(job.projectStep?job.projectStep.fingerprint===stepFingerprint({...step,jobIds:[]}):!step.scopeVersion)&&step.dependsOn.every(id=>acceptedStep(state,steps.find(s=>s.id===id),steps)))}
function requireText(value,label){if(typeof value!=='string'||!value.trim()||value.length>12000)throw Error(`${label}必须为非空文本（最多12000字）`)}
async function persist(root,id,state){await mkdir(join(root,'project-lifecycle'),{recursive:true});await atomicWriteFile(join(root,'project-lifecycle',`${encodeURIComponent(id)}.json`),JSON.stringify(state));return state}
function invalidate(state,steps,step,{reason,evidence,criteria,testerBotId,ownerBotId,actor,kind='defect'}){
 const affected=affectedSteps(steps,step.id),generations={...state.stepGenerations},reviews={...state.reviews},reworks={...state.reworks}
 const previousReviews={},previousReworks={}
 for(const id of affected){
  generations[id]=stepGeneration(state,id)+1
  if(reviews[id])previousReviews[id]=reviews[id];delete reviews[id]
  if(reworks[id]){previousReworks[id]=reworks[id];reworks[id]={...reworks[id],generation:generations[id],cycle:reworks[id].cycle+1,phase:'repair',updatedAt:Date.now()}}
 }
 reworks[step.id]={cycle:(state.reworks?.[step.id]?.cycle||0)+1,generation:generations[step.id],phase:'repair',scopeFingerprint:stepFingerprint({...step,jobIds:[]}),reason,evidence,criteria,kind,ownerBotId:ownerBotId||step.botId,testerBotId,openedAt:Date.now(),updatedAt:Date.now(),needsReview:(state.reworks?.[step.id]?.cycle||0)>=2}
 return {...state,revision:state.revision+1,updatedAt:Date.now(),stepGenerations:generations,reviews,reworks,
 history:[...state.history,{action:'return-step',stepId:step.id,revision:state.revision+1,actor,reason,evidence,criteria,kind,affected,previousReviews,previousReworks,at:Date.now()}]}
}
export async function returnProjectStep(root,id,params,inspect){return projectLock(root,id,async()=>{
 const state=await readLifecycle(root,id)
 if(!['active','paused'].includes(state.status))throw Error('项目已停止；归档或完成项目须先由用户明确恢复')
 if(params.expectedRevision!==state.revision)throw Error('项目版本已变化，请重新读取')
 if(params.kind!==undefined&&!['defect','scope'].includes(params.kind))throw Error('退回类型无效')
 for(const key of ['reason','evidence','criteria'])requireText(params[key],key)
 const {steps,members,jobs}=await inspect(),step=steps.find(s=>s.id===params.stepId)
 if(!step||params.expectedFingerprint!==deliveryFingerprint(state,step))throw Error('阶段版本已变化或不存在')
 if(!members.includes(params.testerBotId)||params.ownerBotId&&!members.includes(params.ownerBotId))throw Error('必须指定项目内的修复和复测负责人')
 if(params.action!==undefined&&!['return','revise'].includes(params.action))throw Error('未知退回操作')
 if(params.action==='revise'&&!state.reworks?.[step.id])throw Error('尚无返工轮次可以调整')
 if(state.reworks?.[step.id]&&state.reworks[step.id].phase!=='passed'&&params.action!=='revise')throw Error('已有返工轮次；请修复、复测并记录结论，不能重复退回')
 const linked=currentStepJobs(state,step,jobs)
 if(params.action!=='revise'&&!currentProjectEvidence(state,step,steps,jobs)&&!linked.some(j=>['replied','failed','cancelled'].includes(j.record.status)))throw Error('阶段尚未交付或结束，不能退回')
 return persist(root,id,invalidate(state,steps,step,params))
})}
export async function recordRetest(root,id,params,inspect){return projectLock(root,id,async()=>{
 const state=await readLifecycle(root,id)
 if(!['active','paused'].includes(state.status))throw Error('项目已停止，不能记录复测')
 if(params.expectedRevision!==state.revision)throw Error('项目版本已变化，请重新读取')
 requireText(params.evidence,'复测证据')
 if(!['passed','failed'].includes(params.result))throw Error('复测结论必须为 passed 或 failed')
 const {steps,jobs}=await inspect(),step=steps.find(s=>s.id===params.stepId),work=state.reworks?.[params.stepId]
 if(!step||!work||work.phase==='passed'||params.generation!==stepGeneration(state,step.id))throw Error('返工轮次已变化或结论已记录')
 const current=currentStepJobs(state,step,jobs),repair=current.filter(j=>j.projectStep?.phase==='repair').at(-1),retest=current.filter(j=>j.projectStep?.phase==='retest').at(-1)
 if(!repair||repair.record.status!=='replied'||!retest||retest.record.status!=='replied'||retest.jobId!==params.testJobId)throw Error('须使用当前轮次已交付的修复与复测记录，成员回复不等于复测通过')
 const event={action:'retest',stepId:step.id,revision:state.revision+1,generation:params.generation,testJobId:retest.jobId,repairJobId:repair.jobId,result:params.result,evidence:params.evidence,actor:params.actor,at:Date.now()}
 if(params.result==='failed'){
  const next=invalidate(state,steps,step,{reason:'复测未通过',evidence:params.evidence,criteria:work.criteria,testerBotId:work.testerBotId,ownerBotId:work.ownerBotId,actor:params.actor,kind:work.kind})
  next.history.splice(next.history.length-1,0,event);return persist(root,id,next)
 }
 const next={...state,revision:state.revision+1,updatedAt:Date.now(),reworks:{...state.reworks,[step.id]:{...work,phase:'passed',testJobId:retest.jobId,repairJobId:repair.jobId,evidence:params.evidence,updatedAt:Date.now()}},history:[...state.history,event]}
 return persist(root,id,next)
})}
