import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {atomicWriteFile} from './inbox.mjs'
import {readLifecycle,projectLock,deliveryFingerprint,stepGeneration,acceptedStep} from './project-lifecycle.mjs'

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sourceDigest=job=>digest({jobId:job.jobId,conversationId:job.conversationId,toBot:job.toBot,projectEpoch:job.projectEpoch||0,projectStep:job.projectStep,record:job.record,checkpoint:job.checkpoint})
export function evidenceDependencies(state,step){return Object.fromEntries(step.dependsOn.map(id=>[id,state.reviews?.[id]?.fingerprint]))}
const sameDependencies=(a,b)=>a&&Object.keys(a).length===Object.keys(b).length&&Object.keys(b).every(k=>a[k]===b[k])
function validate(state,step,steps,jobs,entry){
 if(!step||!['active','paused'].includes(state.status))throw Error('项目状态不允许登记成果')
 if(entry.epoch!==state.epoch||entry.generation!==stepGeneration(state,step.id)||entry.fingerprint!==deliveryFingerprint(state,step))throw Error('成果登记属于旧阶段版本')
 if(state.reworks?.[step.id]&&state.reworks[step.id].phase!=='passed')throw Error('返工尚未完成复测，不能复用成果绕过返工')
 if(!step.dependsOn.every(id=>acceptedStep(state,steps.find(s=>s.id===id),steps))||!sameDependencies(entry.dependencyFingerprints,evidenceDependencies(state,step)))throw Error('前置验收或依赖版本已变化')
 if(step.finalDelivery&&steps.some(s=>s.id!==step.id&&!acceptedStep(state,s,steps)))throw Error('最终交付仍有阶段未验收')
 const source=jobs.find(j=>j.jobId===entry.sourceJobId)
 if(!source||source.conversationId!==state.conversationId||(source.projectEpoch||0)!==state.epoch||source.toBot!==step.botId||source.record?.status!=='replied')throw Error('来源须为同项目同批次负责人已交付任务')
 const busy=jobs.some(j=>(j.projectStep?.id===step.id||step.jobIds.includes(j.jobId))&&!['replied','failed','cancelled'].includes(j.record?.status))
 if(busy)throw Error('阶段仍有排队或执行任务，不能登记已有成果')
 if(!Array.isArray(entry.artifacts)||!entry.artifacts.length||entry.artifacts.some(file=>typeof file!=='string'||!file.trim()||!source.checkpoint?.files?.includes(file)))throw Error('必须引用来源交付记录中实际登记的文件')
 if(entry.sourceDigest&&entry.sourceDigest!==sourceDigest(source))throw Error('来源交付证据已变化，请重新核验')
 return source
}
// Registration makes a delivery available for review. It never accepts a stage,
// changes a job, or manufactures repair/retest execution evidence.
export function currentProjectEvidence(state,step,steps,jobs){
 const entry=state.deliveryEvidence?.[step.id];if(!entry)return null
 try{validate(state,step,steps,jobs,entry);return entry}catch{return null}
}
export async function registerProjectEvidence(root,id,params,inspect){return projectLock(root,id,async()=>{
 const state=await readLifecycle(root,id)
 if(params.expectedRevision!==state.revision)throw Error('项目版本已变化，请重新读取')
 if(typeof params.evidence!=='string'||!params.evidence.trim()||params.evidence.length>12000)throw Error('必须说明已有成果对当前要求及依赖的适用性（最多12000字）')
 if(typeof params.actor!=='string'||!params.actor.trim())throw Error('必须记录成果核验人')
 const {steps,jobs}=await inspect(),step=steps.find(s=>s.id===params.stepId)
 const entry={stepId:params.stepId,sourceJobId:params.sourceJobId,epoch:params.expectedEpoch,generation:params.expectedGeneration,fingerprint:params.expectedFingerprint,dependencyFingerprints:params.dependencyFingerprints,artifacts:params.artifacts,evidence:params.evidence.trim(),actor:params.actor,at:Date.now()}
 const source=validate(state,step,steps,jobs,entry)
 if(acceptedStep(state,step,steps))throw Error('阶段已验收，无需重复登记')
 entry.sourceDigest=sourceDigest(source)
 const previous=currentProjectEvidence(state,step,steps,jobs)
 if(previous&&previous.sourceDigest===entry.sourceDigest&&digest(previous.artifacts)===digest(entry.artifacts)&&previous.evidence===entry.evidence)return state
 const next={...state,revision:state.revision+1,updatedAt:entry.at,deliveryEvidence:{...state.deliveryEvidence,[step.id]:entry},history:[...state.history,{...entry,action:'register-evidence',revision:state.revision+1}]}
 await mkdir(join(root,'project-lifecycle'),{recursive:true})
 await atomicWriteFile(join(root,'project-lifecycle',`${encodeURIComponent(id)}.json`),JSON.stringify(next));return next
})}
