import {readFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {readLifecycle,projectLock,deliveryFingerprint,acceptedStep} from './project-lifecycle.mjs'
import {readPlan} from './project-board.mjs'
import {atomicWriteFile} from './inbox.mjs'
// Idempotent upgrade. Only approvals that still match the exact legacy delivery
// are carried forward. Invalid historical decisions stay invalid and auditable.
export async function migrateDeliveryIdentity(root,id){return projectLock(root,id,async()=>{
 const state=await readLifecycle(root,id)
 if(state.deliveryIdentityVersion===2)return state
 const plan=await readPlan(root,id),next={...state,deliveryIdentityVersion:2,reviews:{...state.reviews}}
 const mappings=new Map()
 for(const key of Object.keys(next.reviews))if(!plan.steps.some(s=>s.id===key))delete next.reviews[key]
 for(const step of plan.steps){
  const old=deliveryFingerprint(state,step),fresh=deliveryFingerprint(next,step)
  mappings.set(old,fresh)
  if(acceptedStep(state,step,plan.steps))next.reviews[step.id]={...state.reviews[step.id],legacyFingerprint:old,fingerprint:fresh}
  else delete next.reviews[step.id]
 }
 for(const [id,review] of Object.entries(next.reviews)){
  if(!review.legacyFingerprint)continue
  next.reviews[id]={...review,dependencyFingerprints:Object.fromEntries(Object.entries(review.dependencyFingerprints||{}).map(([k,v])=>[k,mappings.get(v)||v]))}
 }
 const path=join(root,'project-handoffs',`${encodeURIComponent(id)}.json`)
 let handoff
 try{handoff=JSON.parse(await readFile(path,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 if(handoff){for(const request of handoff.requests||[]){const mapped=mappings.get(request.fingerprint);if(mapped){request.legacyFingerprint=request.fingerprint;request.fingerprint=mapped}else request.superseded=true}
  await atomicWriteFile(path,JSON.stringify(handoff))}
 next.revision=state.revision+1;next.updatedAt=Date.now();next.history=[...state.history,{action:'delivery-identity-upgrade',revision:next.revision,at:next.updatedAt,previousReviews:state.reviews,reason:'历史任务关联与交付范围/返工轮次分离；只迁移仍有效验收'}]
 await mkdir(join(root,'project-lifecycle'),{recursive:true});await atomicWriteFile(join(root,'project-lifecycle',`${encodeURIComponent(id)}.json`),JSON.stringify(next));return next
})}
