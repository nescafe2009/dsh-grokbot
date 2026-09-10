import {currentStepJobs,reworkView,affectedSteps} from './project-rework.mjs'
import {readLifecycle,acceptedStep,withActiveProject,stepFingerprint,deliveryFingerprint,stepGeneration,reviewModeOf} from './project-lifecycle.mjs'
import {readFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {listTasks} from './tasks.mjs'
import {atomicWriteFile} from './inbox.mjs'
const planPath=(root,id)=>join(root,'project-plans',`${encodeURIComponent(id)}.json`)
export async function readPlan(root,id){try{return JSON.parse(await readFile(planPath(root,id),'utf8'))}catch(e){if(e.code==='ENOENT')return {steps:[]};throw e}}
export async function savePlan(root,id,steps,members,jobs,expectedRevision){return withActiveProject(root,id,state=>savePlanActive(root,id,steps,members,jobs,state,expectedRevision))}
async function savePlanActive(root,id,steps,members,jobs,state,expectedRevision){
 if(!Array.isArray(steps)||steps.length>40)throw Error('计划必须是最多 40 个步骤的数组')
 const previous=await readPlan(root,id)
 if(expectedRevision!==undefined&&expectedRevision!==(previous.revision||0))throw Error('计划版本已变化，请重新读取后调整')
 const ids=new Set(),usedJobs=new Set()
 const clean=steps.map(s=>{
  if(!/^[a-zA-Z0-9_-]{1,50}$/.test(s.id)||ids.has(s.id))throw Error('步骤 id 无效或重复');ids.add(s.id)
  if(typeof s.title!=='string'||!s.title.trim()||!members.includes(s.botId))throw Error('步骤必须有标题和本群负责人')
  const jobIds=s.jobIds??[],dependsOn=s.dependsOn??[]
  if(!Array.isArray(jobIds)||!Array.isArray(dependsOn))throw Error('jobIds 和 dependsOn 必须是数组')
  for(const j of jobIds){if(usedJobs.has(j)||!jobs.some(x=>x.jobId===j&&x.toBot===s.botId))throw Error('关联任务不存在、不属本群负责人或重复关联');usedJobs.add(j)}
  const previousStep=previous.steps.find(p=>p.id===s.id)
  let reviewMode=s.reviewMode??previousStep?.reviewMode
  // Missing means user, not a different policy. Preserve legacy representation
  // so a routine plan save cannot invalidate existing execution or acceptance.
  if(previousStep&&!previousStep.reviewMode&&reviewMode==='user')reviewMode=undefined
  if(reviewMode!==undefined&&!['chief','user'].includes(reviewMode))throw Error('验收分工无效')
  const next={...((s.finalDelivery??previousStep?.finalDelivery)?{finalDelivery:true}:{}),...(reviewMode?{reviewMode}:{}),id:s.id,title:s.title.trim().slice(0,120),botId:s.botId,dependsOn:[...new Set(dependsOn)],jobIds:[...jobIds]}
  const old=previous.steps.find(p=>p.id===s.id)
  if(old){
   if(old.jobIds.some(j=>!next.jobIds.includes(j)))throw Error('历史任务关联不能删除；返工请保留原记录')
   const scopeVersion=(old.scopeVersion||0)+(stepFingerprint({...old,scopeVersion:undefined,jobIds:[]})!==stepFingerprint({...next,jobIds:[]})?1:0)
   if(scopeVersion)next.scopeVersion=scopeVersion
  }
  return next
 })
 const scopeChanged=clean.filter(s=>{const old=previous.steps.find(p=>p.id===s.id);return old&&(s.scopeVersion||0)>(old.scopeVersion||0)}).map(s=>s.id)
 for(const id of new Set(scopeChanged.flatMap(id=>affectedSteps(clean,id)))){
  const next=clean.find(s=>s.id===id),old=previous.steps.find(s=>s.id===id)
  if(old)next.scopeVersion=Math.max(next.scopeVersion||0,(old.scopeVersion||0)+1)
 }
 for(const old of previous.steps){
  const work=state.reworks?.[old.id],next=clean.find(s=>s.id===old.id)
  if(work&&work.phase!=='passed'&&(!next||stepFingerprint({...old,jobIds:[]})!==stepFingerprint({...next,jobIds:[]})))throw Error('返工未闭环，不能删除或改写阶段范围、负责人、依赖与验收要求')
 }
 const visiting=new Set(),visited=new Set()
 function visit(id){if(visiting.has(id))throw Error('计划依赖不能成环');if(visited.has(id))return;const s=clean.find(x=>x.id===id);if(!s)throw Error('前置步骤不存在');visiting.add(id);s.dependsOn.forEach(visit);visiting.delete(id);visited.add(id)}
 for(const s of clean)if(s.reviewMode==='chief'&&!clean.some(next=>next.dependsOn.includes(s.id)))throw Error('最终交付必须由用户验收')
 clean.forEach(s=>visit(s.id))
 for(const final of clean.filter(s=>s.finalDelivery)){
  const ancestors=new Set();const collect=s=>s.dependsOn.forEach(id=>{if(!ancestors.has(id)){ancestors.add(id);collect(clean.find(x=>x.id===id))}});collect(final)
  if(clean.some(s=>s.id!==final.id&&!ancestors.has(s.id)))throw Error('最终质量验收必须依赖全部必交付阶段，不能遗漏音频、输入或其他分支')
 }
 await mkdir(join(root,'project-plans'),{recursive:true});const plan={steps:clean,revision:(previous.revision||0)+1,updatedAt:Date.now(),history:[...(previous.history||[]),{revision:previous.revision||0,steps:previous.steps,at:Date.now()}]};await atomicWriteFile(planPath(root,id),JSON.stringify(plan));return plan
}
export async function readProjectJobs(inboxRoot,conversationId){
 let raw;try{raw=await readFile(join(inboxRoot,'queue.jsonl'),'utf8')}catch(e){if(e.code==='ENOENT')return [];throw e}
 const entries=new Map()
 for(const line of raw.split('\n')){try{const j=JSON.parse(line);if(j.conversationId===conversationId&&/^[A-Za-z0-9_-]+$/.test(j.jobId))entries.set(j.jobId,j)}catch{}}
 return Promise.all([...entries.values()].map(async j=>{let status={};try{status=JSON.parse(await readFile(join(inboxRoot,j.jobId,'status.json'),'utf8'))}catch{}let checkpoint=null,progress=null;try{checkpoint=JSON.parse(await readFile(join(inboxRoot,j.jobId,'checkpoint.json'),'utf8'))}catch{}try{progress=JSON.parse(await readFile(join(inboxRoot,j.jobId,'progress.json'),'utf8'))}catch{}return {...j,record:status,checkpoint,progress}}))
}
export async function projectBoard({stateDir,inboxRoot,conversationId,bots,runningIds=[],queuedIds=[],approvals=[],active=[]}){
 const [lifecycle,jobs,tasks,plan]=await Promise.all([readLifecycle(stateDir,conversationId),readProjectJobs(inboxRoot,conversationId),listTasks(stateDir,{conversationId}),readPlan(stateDir,conversationId)])
 const running=new Set(runningIds),queued=new Set(queuedIds)
 const statusOf=j=>({replied:'done',failed:'failed',cancelled:'cancelled'}[j.record.status])||(running.has(j.jobId)?'running':lifecycle.status!=='active'&&(!j.record.status||j.record.status==='queued'||queued.has(j.jobId))?'held':queued.has(j.jobId)||!j.record.status||j.record.status==='queued'?'queued':'unknown')
 const rows=jobs.map(j=>({id:j.jobId,title:String(j.text||'任务').replace(/^\[[^\]]+\]\s*/, '').slice(0,120),botId:j.record.botId||j.toBot,status:statusOf(j),checkpoint:j.checkpoint,progress:running.has(j.jobId)?j.progress:null,reason:String(j.record.error||j.record.reason||'').slice(0,300),createdAt:j.createdAt||0,updatedAt:j.record.endedAt||j.record.startedAt||j.createdAt||0,dependsOn:[],artifacts:0,source:'job'}))
 for(const t of tasks){
  const run=t.runs?.at(-1),job=rows.find(r=>r.id===run?.executor?.jobId||jobs.find(j=>j.jobId===r.id)?.taskId===t.id)
  if(job){job.taskId=t.id;job.artifacts=t.artifacts?.length||0;continue}
  rows.push({id:t.id,title:t.title,botId:run?.botId||t.ownerBotId,status:run?.status==='running'?(active.some(a=>a.taskId===t.id)?'running':'unknown'):(run?.status||'planned'),reason:'',updatedAt:t.updatedAt,artifacts:t.artifacts?.length||0,dependsOn:[],source:'task',taskId:t.id})
 }
 for(const a of active){if(rows.some(r=>r.id===a.jobId||r.taskId&&r.taskId===a.taskId))continue;rows.push({id:`active-${a.botId}`,title:a.botId==='chief'?'幕僚长协调':'当前会话处理',botId:a.botId,status:'running',reason:'',dependsOn:[],artifacts:0,source:'live'})}
 for(const row of rows){const approval=approvals.find(a=>a.botId===row.botId&&(a.jobId===row.id||a.taskId&&a.taskId===row.taskId||row.source==='live'));if(approval&&row.status==='running'){row.status=approval.stage==='chief'?'review':'approval';row.reason=approval.reviewReason||approval.reason}}
 const used=new Set(),planned=plan.steps.map(s=>{
  const current=currentStepJobs(lifecycle,s,jobs),linked=current.map(j=>rows.find(r=>r.id===j.jobId)).filter(Boolean)
  current.forEach(j=>used.add(j.jobId))
  const observed=linked.some(r=>['running','queued','approval','review'].includes(r.status))?linked.find(r=>['running','queued','approval','review'].includes(r.status)).status:linked.at(-1)?.status||'planned'
  const rework=reworkView(lifecycle,s,jobs)
  let checkpoint=linked.at(-1)?.checkpoint||null
  if(rework&&checkpoint){
   const repaired=current.filter(j=>j.projectStep?.phase==='repair').at(-1)?.checkpoint
   checkpoint={...checkpoint,files:[...new Set([...(repaired?.files||[]),...(checkpoint.files||[])])]}
  }
  let status=observed==='done'?(acceptedStep(lifecycle,s,plan.steps)?'done':'awaiting_acceptance'):observed
  if(rework&&!acceptedStep(lifecycle,s,plan.steps)&&!['approval','review','held'].includes(observed))status=rework.status
  return {...s,reviewMode:reviewModeOf(lifecycle,s),accepted:acceptedStep(lifecycle,s,plan.steps),executionStatus:observed,latestJobId:current.at(-1)?.jobId||null,retryable:['failed','cancelled'].includes(observed),fingerprint:deliveryFingerprint(lifecycle,s),generation:stepGeneration(lifecycle,s.id),rework,status,source:'plan',artifacts:linked.reduce((n,r)=>n+r.artifacts,0),reason:rework?.reason||linked.at(-1)?.reason||'',updatedAt:Math.max(rework?.updatedAt||0,...linked.map(r=>r.updatedAt||0)),checkpoint,progress:linked.at(-1)?.progress||null}

 })
 for(const p of planned)if(!['running','approval','review'].includes(p.status)&&p.dependsOn.some(id=>planned.find(r=>r.id===id)?.status!=='done')){p.status='blocked';p.reason='等待前置阶段验收通过'}
 const ordered=[],seen=new Set();function add(p){if(seen.has(p.id))return;seen.add(p.id);p.dependsOn.forEach(id=>{const d=planned.find(r=>r.id===id);if(d)add(d)});ordered.push(p)}planned.forEach(add)
 return {conversationId,lifecycle,planRevision:plan.revision||0,updatedAt:Date.now(),hasPlan:planned.length>0,rows:[...ordered,...rows.filter(r=>!used.has(r.id)).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))],members:bots.map(b=>({id:b.id,name:b.name,status:b.status}))}
}
