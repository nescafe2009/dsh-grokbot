import {readFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {atomicWriteFile} from './inbox.mjs'
import {projectLock,stepFingerprint} from './project-lifecycle.mjs'
const pathOf=(root,id)=>join(root,'project-handoffs',`${encodeURIComponent(id)}.json`)
export async function readHandoff(root,id){
 try{return JSON.parse(await readFile(pathOf(root,id),'utf8'))}catch(e){if(e.code==='ENOENT')return {version:1,originConversationId:null,requests:[]};throw e}
}
async function save(root,id,state){await mkdir(join(root,'project-handoffs'),{recursive:true});await atomicWriteFile(pathOf(root,id),JSON.stringify(state))}
export async function bindProjectOrigin(root,id,originConversationId){return projectLock(root,id,async()=>{
 const state=await readHandoff(root,id)
 if(!state.originConversationId){state.originConversationId=originConversationId;await save(root,id,state)}
 return state
})}
/** Durable outbox. Delivery is acknowledged only after the transcript append succeeds.
 * A stable messageId lets the destination deduplicate a retry after a crash. */
export async function prepareHandoff(root,id,{name,rows,epoch,summary,originConversationId,materialize=async()=>[]}){return projectLock(root,id,async()=>{
 const state=await readHandoff(root,id);state.originConversationId ||= originConversationId
 const pending=rows.filter(r=>r.source==='plan'&&r.status==='awaiting_acceptance'&&r.reviewMode!=='chief'&&r.reviewMode!=='codex')
 const current=new Set(pending.map(row=>row.fingerprint||stepFingerprint(row)))
 for(const r of state.requests)if(!current.has(r.fingerprint)||r.epoch!==epoch)r.superseded=true
 for(const row of pending){
  const fingerprint=row.fingerprint||stepFingerprint(row)
  if(state.requests.some(r=>r.fingerprint===fingerprint&&r.epoch===epoch&&!r.superseded))continue
  const requestId=createHash('sha256').update(`${id}:${epoch}:${fingerprint}`).digest('hex')
  const files=row.checkpoint?.files||[]
  const artifacts=await materialize(row)
  const text=`【${name} · 请你审阅】\n待审阅：${row.title}\n${artifacts.length?'打开成果：\n'+artifacts.map(a=>`- [${a.name}](/api/plugins/grokbot/artifacts/${a.id})`).join('\n'):files.length?'成果路径：\n'+files.map(f=>`- ${f}`).join('\n'):'成果入口尚未登记，请幕僚长补充核实。'}\n\n请在本会话告诉幕僚长“通过此阶段”或说明修改意见。通过前不会放行依赖此阶段的任务。`
  state.requests.push({requestId,stepId:row.id,fingerprint,epoch,text,artifacts,status:'pending',createdAt:Date.now(),attempts:0})
 }
 await save(root,id,state);return state
})}
export async function flushHandoff(root,id,deliver,validate=async()=>true){return projectLock(root,id,async()=>{
 const state=await readHandoff(root,id)
 for(const request of state.requests){
  if(request.status!=='pending'||request.superseded||request.nextAttemptAt>Date.now())continue
  try{
   if(!await validate(request)){request.superseded=true;await save(root,id,state);continue}
   await deliver(state.originConversationId,{role:'bot',botId:'chief',text:request.text,messageId:`handoff-${request.requestId}`,projectId:id,requestId:request.requestId})
   request.status='delivered';request.deliveredAt=Date.now();delete request.error
  }catch(e){request.attempts++;request.error=String(e.message).slice(0,300);request.nextAttemptAt=Date.now()+Math.min(300000,1000*2**Math.min(request.attempts,8))}
  await save(root,id,state)
 }
 return state
})}
export async function reviewRequest(root,id,requestId){
 const state=await readHandoff(root,id),request=state.requests.find(r=>r.requestId===requestId&&!r.superseded)
 if(!request||request.status!=='delivered')throw Error('没有已送达且有效的审阅请求；请先核对项目和成果版本')
 return request
}
