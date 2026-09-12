import {returnProjectStep} from './project-rework.mjs'
import {readFile,mkdir,realpath,stat} from 'node:fs/promises'
import {join,resolve,relative,isAbsolute} from 'node:path'
import {createHash} from 'node:crypto'
import {atomicWriteFile} from './inbox.mjs'
import {projectLock,readLifecycle,acceptProjectStep} from './project-lifecycle.mjs'
import {readPlan,projectBoard,readProjectJobs} from './project-board.mjs'
const path=(root,id)=>join(root,'external-reviews',encodeURIComponent(id)+'.json')
export async function readExternalReviews(root,id){try{return JSON.parse(await readFile(path(root,id),'utf8'))}catch(e){if(e.code==='ENOENT')return [];throw e}}
export async function configureExternalReviewer(root,id,threadId){return projectLock(root,id,async()=>{
 if(!threadId?.trim())throw Error('需要明确的 Codex 接收任务')
 const state=await readLifecycle(root,id)
 if(state.externalReviewer?.threadId===threadId)return state
 const next={...state,externalReviewer:{kind:'codex',threadId},revision:state.revision+1,history:[...state.history,{action:'external-reviewer',actor:'user-delegated-codex',at:Date.now(),threadId}]}
 await mkdir(join(root,'project-lifecycle'),{recursive:true});await atomicWriteFile(join(root,'project-lifecycle',encodeURIComponent(id)+'.json'),JSON.stringify(next));return next
})}
async function artifactManifest(root,board,row){
 const ids=new Set(),visit=id=>{if(ids.has(id))return;ids.add(id);board.rows.find(r=>r.source==='plan'&&r.id===id)?.dependsOn.forEach(visit)};visit(row.id)
 const files=[...new Set(board.rows.filter(r=>r.source==='plan'&&ids.has(r.id)).flatMap(r=>r.checkpoint?.files||[]))].sort()
 const workspace=await realpath(join(root,'workspace')).catch(()=>resolve(root,'workspace'))
 return Promise.all(files.map(async file=>{
  try{const source=await realpath(resolve(workspace,file)).catch(async error=>{if(file.startsWith('workspace/'))return realpath(resolve(workspace,file.slice(10)));throw error}),rel=relative(workspace,source)
   if(rel.startsWith('..')||isAbsolute(rel))throw Error('outside-workspace')
   const info=await stat(source);if(!info.isFile()||info.size>32*1024*1024)throw Error('unsupported-artifact')
   return {file,sha256:createHash('sha256').update(await readFile(source)).digest('hex')}
  }catch{return {file,error:'成果缺失或不在可核验工作区'}}
 }))
}
export async function syncExternalReviews(root,id,board){return projectLock(root,id,async()=>{
 const state=await readLifecycle(root,id);if(!state.externalReviewer)return []
 if(state.revision!==board.lifecycle.revision||(await readPlan(root,id)).revision!==board.planRevision)return readExternalReviews(root,id)
 const old=await readExternalReviews(root,id),records=structuredClone(old),pending=[]
 if(['active','paused'].includes(state.status))for(const row of board.rows.filter(r=>r.source==='plan'&&r.status==='awaiting_acceptance'&&r.reviewMode==='codex')){
  const artifacts=await artifactManifest(root,board,row)
  const fingerprint=createHash('sha256').update(JSON.stringify([id,state.epoch,row.id,row.fingerprint,row.dependsOn.map(d=>[d,state.reviews[d]?.fingerprint]),artifacts])).digest('hex')
  pending.push(fingerprint)
  const previous=records.find(r=>r.fingerprint===fingerprint);if(previous?.status==='superseded'){previous.status='pending';delete previous.closedAt}
  if(!records.some(r=>r.fingerprint===fingerprint))records.push({id:fingerprint,projectId:id,stepId:row.id,title:row.title,fingerprint,deliveryFingerprint:row.fingerprint,epoch:state.epoch,reviewer:'codex',threadId:state.externalReviewer.threadId,status:'pending',artifacts,createdAt:Date.now(),evidence:row.dependsOn.map(d=>({stepId:d,...state.reviews[d]}))})
 }
 for(const r of records)if(r.status==='pending'&&!pending.includes(r.fingerprint)){r.status='superseded';r.closedAt=Date.now()}
 if(JSON.stringify(old)!==JSON.stringify(records)){await mkdir(join(root,'external-reviews'),{recursive:true});await atomicWriteFile(path(root,id),JSON.stringify(records))}
 return records
})}
// Host-side operator API only: never registered as a model tool or HTTP decision route.
export async function decideExternalReview(root,inboxRoot,id,{requestId,decision,evidence,returnStepId,testerBotId,criteria}){
 if(!['accept','reject'].includes(decision)||!evidence?.trim())throw Error('必须明确审核决定和证据')
 const board=await projectBoard({stateDir:root,inboxRoot,conversationId:id,bots:[]})
 const records=await syncExternalReviews(root,id,board),request=records.find(r=>r.id===requestId&&r.status==='pending')
 if(!request)throw Error('待审请求不存在、已处理或版本已失效')
 if(decision==='reject'){
  const step=board.rows.find(r=>r.source==='plan'&&r.id===returnStepId)
  if(!step||!testerBotId||!criteria?.trim())throw Error('驳回必须指定问题阶段、独立复测人和复测标准')
  const crew=JSON.parse(await readFile(join(root,'crew.json'),'utf8')),room=crew.conversations?.find(c=>c.id===id)
  await returnProjectStep(root,id,{stepId:returnStepId,expectedRevision:board.lifecycle.revision,expectedFingerprint:step.fingerprint,reason:'Codex 交付验收未通过',evidence,criteria,testerBotId,actor:'codex'},async()=>({steps:(await readPlan(root,id)).steps,jobs:await readProjectJobs(inboxRoot,id),members:room?.memberBotIds||[]}))
 }
 if(decision==='accept'&&request.artifacts?.some(a=>a.error))throw Error('交付引用含无法核验的文件，须补齐后验收')
 if(decision==='accept')await acceptProjectStep(root,id,{expectedRevision:board.lifecycle.revision,stepId:request.stepId,expectedFingerprint:request.deliveryFingerprint,expectedEpoch:request.epoch,actor:'codex',evidence},async stepId=>({step:(await readPlan(root,id)).steps.find(s=>s.id===stepId),ready:board.rows.some(r=>r.id===stepId&&r.status==='awaiting_acceptance')}))
 return projectLock(root,id,async()=>{const rows=await readExternalReviews(root,id),r=rows.find(r=>r.id===requestId);r.status=decision==='accept'?'accepted':'rejected';r.decisionEvidence=evidence;r.decidedAt=Date.now();await atomicWriteFile(path(root,id),JSON.stringify(rows));return r})
}
