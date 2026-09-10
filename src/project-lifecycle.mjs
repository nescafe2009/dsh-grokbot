import {readFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {atomicWriteFile} from './inbox.mjs'

const locks=new Map(), leases=new Map()
const key=(root,id)=>join(root,'project-lifecycle',`${encodeURIComponent(id)}.json`)
export async function projectLock(root,id,fn){
 const k=key(root,id), previous=locks.get(k)||Promise.resolve()
 let release;const next=new Promise(r=>{release=r});locks.set(k,next)
 await previous
 try{return await fn()}finally{release();if(locks.get(k)===next)locks.delete(k)}
}
export async function readLifecycle(root,id){
 try{const s=JSON.parse(await readFile(key(root,id),'utf8'));if(s.version!==1||!Number.isSafeInteger(s.revision)||!Number.isSafeInteger(s.epoch)||!Array.isArray(s.history)||!s.reviews||!['active','paused','blocked','completed','cancelled','archived'].includes(s.status))throw Error('项目生命周期损坏，停止执行');return s}
 catch(e){if(e.code==='ENOENT')return {version:1,deliveryIdentityVersion:2,conversationId:id,status:'active',epoch:0,revision:0,summary:'',reviews:{},history:[]};throw e}
}
function active(s){if(s.status!=='active')throw Error(`项目为 ${s.status}，不能派工或自动执行；请先明确恢复项目`)}
export async function withActiveProject(root,id,fn){if(!id)return fn();return projectLock(root,id,async()=>{const state=await readLifecycle(root,id);active(state);return fn(state)})}
// A lease spans native execution, while the short project lock spans admission only.
export async function admitProject(root,id,validate=async()=>{}){
 if(!id)return ()=>{}
 return withActiveProject(root,id,async state=>{await validate(state);const k=key(root,id);leases.set(k,(leases.get(k)||0)+1);let closed=false;return ()=>{if(!closed){closed=true;leases.set(k,Math.max(0,(leases.get(k)||0)-1))}}})
}
export function stepFingerprint(step){return createHash('sha256').update(JSON.stringify({...(step.scopeVersion?{scopeVersion:step.scopeVersion}:{}),...(step.reviewMode?{reviewMode:step.reviewMode}:{}),id:step.id,title:step.title,botId:step.botId,dependsOn:step.dependsOn,jobIds:step.jobIds})).digest('hex')}
export const stepGeneration=(state,id)=>state.stepGenerations?.[id]||0
export function deliveryFingerprint(state,step){const base=state.deliveryIdentityVersion===2?stepFingerprint({...step,jobIds:[]}):stepFingerprint(step),generation=stepGeneration(state,step.id);return generation?createHash('sha256').update(`${base}:${generation}`).digest('hex'):base}
export function acceptedStep(state,step,steps=null,seen=new Set()){
 if(!step||step.finalDelivery&&state.reviews?.[step.id]?.actor!=='user'||seen.has(step.id)||state.reviews?.[step.id]?.fingerprint!==deliveryFingerprint(state,step)||state.reworks?.[step.id]&&state.reworks[step.id].phase!=='passed')return false
 if(!steps)return true
 const next=new Set(seen);next.add(step.id)
 const dependencies=state.reviews[step.id].dependencyFingerprints
 if(dependencies&&step.dependsOn.some(id=>dependencies[id]!==state.reviews[id]?.fingerprint))return false
 return step.dependsOn.every(id=>acceptedStep(state,steps.find(s=>s.id===id),steps,next))
}
export async function transitionProject(root,id,{action,expectedRevision,summary,blocker,actor='user'},inspect=async()=>({})){return projectLock(root,id,async()=>{
 const s=await readLifecycle(root,id)
 if(expectedRevision!==s.revision)throw Error('项目版本已变化，请重新读取后操作')
 if(typeof summary!=='string'||!summary.trim()||summary.length>12000)throw Error('必须提供项目摘要或操作原因（最多12000字）')
 const targets={pause:'paused',block:'blocked',resume:'active',complete:'completed',cancel:'cancelled',archive:'archived',restore:'paused'}
 const to=targets[action];if(!to)throw Error('未知生命周期操作')
 const allowed={pause:['active','blocked'],block:['active','paused'],resume:['paused','blocked'],complete:['active','paused'],cancel:['active','paused','blocked'],archive:['active','paused','blocked','completed','cancelled'],restore:['archived','completed','cancelled']}
 if(!allowed[action].includes(s.status))throw Error(`不允许 ${s.status} → ${to}`)
 if(action==='block'&&(!blocker?.reason?.trim()||!blocker?.resolution?.trim()||!blocker?.owner?.trim()))throw Error('阻塞必须指定原因、负责人和解除条件')
 const live=await inspect()
 if(['archive','complete','cancel'].includes(action)&&((leases.get(key(root,id))||0)>0||live.running))throw Error('项目仍有执行中操作；请先暂停，等待执行收尾后再操作')
 if(action==='complete'&&(!live.allAccepted||live.queued))throw Error('项目仍有未验收阶段或排队任务，不能完成')
 const next={...s,status:to,epoch:(s.epoch||0)+(['archive','cancel'].includes(action)?1:0),snapshot:action==='archive'?live.snapshot:s.snapshot,revision:s.revision+1,summary:summary.trim(),blocker:action==='block'?blocker:null,updatedAt:Date.now(),previousStatus:s.status,
 history:[...s.history,{revision:s.revision+1,from:s.status,to,action,actor,at:Date.now(),summary:summary.trim()}]}
 await mkdir(join(root,'project-lifecycle'),{recursive:true});await atomicWriteFile(key(root,id),JSON.stringify(next));return next
})}
export async function acceptProjectStep(root,id,{expectedRevision,stepId,evidence,expectedFingerprint,expectedEpoch,actor='user'},inspect){return projectLock(root,id,async()=>{
 const s=await readLifecycle(root,id)
 if(!['active','paused'].includes(s.status))throw Error('当前项目状态不允许验收')
 if(expectedRevision!==s.revision)throw Error('项目版本已变化，请重新读取')
 if(typeof evidence!=='string'||!evidence.trim()||evidence.length>12000)throw Error('必须提供验收证据说明')
 const {step,ready}=await inspect(stepId)
 if(!step||!ready)throw Error('阶段尚未交付、前置未验收或仍在执行，不能验收')
 if(expectedEpoch!==undefined&&expectedEpoch!==s.epoch)throw Error('审阅请求属于旧项目批次，请重新提交审阅')
 if(expectedFingerprint&&acceptedStep(s,step))throw Error('该阶段已验收，无需重复操作')
 if(s.reworks?.[stepId]&&s.reworks[stepId].phase!=='passed')throw Error('返工尚未完成复测，不能验收')
 if(expectedFingerprint&&deliveryFingerprint(s,step)!==expectedFingerprint)throw Error('审阅后阶段或成果版本已变化，请重新提交审阅')
 const next={...s,revision:s.revision+1,updatedAt:Date.now(),history:[...s.history,{revision:s.revision+1,action:'accept-step',stepId,actor,evidence,at:Date.now()}],reviews:{...s.reviews,[step.id]:{fingerprint:deliveryFingerprint(s,step),dependencyFingerprints:Object.fromEntries(step.dependsOn.map(id=>[id,s.reviews[id]?.fingerprint])),evidence,actor,at:Date.now()}}}
 await mkdir(join(root,'project-lifecycle'),{recursive:true});await atomicWriteFile(key(root,id),JSON.stringify(next));return next
})}

export function reviewModeOf(state,step){return state.reviewPolicies?.[step.id]?.mode||step.reviewMode||'user'}
export async function setReviewPolicy(root,id,{expectedRevision,stepId,mode,evidence,userText},inspect){return projectLock(root,id,async()=>{
 const state=await readLifecycle(root,id),steps=await inspect(),step=steps.find(s=>s.id===stepId)
 if(!['active','paused'].includes(state.status)||state.revision!==expectedRevision)throw Error('项目状态或版本已变化')
 if(!step||!['user','chief'].includes(mode)||!evidence?.trim()||!userText?.trim())throw Error('必须指定阶段、验收分工与当前用户授权证据')
 if(mode==='chief'&&(step.finalDelivery||!steps.some(s=>s.dependsOn.includes(step.id))))throw Error('最终交付仍需用户验收')
 const event={action:'review-policy',stepId,mode,evidence,userText,actor:'user-via-chief',at:Date.now()}
 const next={...state,revision:state.revision+1,updatedAt:event.at,reviewPolicies:{...state.reviewPolicies,[stepId]:event},history:[...state.history,event]}
 await mkdir(join(root,'project-lifecycle'),{recursive:true});await atomicWriteFile(key(root,id),JSON.stringify(next));return next
})}
