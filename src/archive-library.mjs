import {readdir, readFile, access} from 'node:fs/promises'
import {join} from 'node:path'
import {readLifecycle, acceptedStep} from './project-lifecycle.mjs'

// Read-only catalog: membership comes from recorded conversation IDs, never names/paths.
export async function archiveLibrary(stateDir, crew) {
 const artifacts=[]
 for(const id of await readdir(join(stateDir,'artifacts')).catch(()=>[])) {
  try {
   const m=JSON.parse(await readFile(join(stateDir,'artifacts',id,'meta.json'),'utf8'))
   if(m.kind==='user-screenshot'||!m.name || !/^[a-zA-Z0-9_-]+$/.test(id))continue
   await access(join(stateDir,'artifacts',id,'data','payload'))
   artifacts.push({...m,id})
  }catch{/* A missing snapshot must not become a broken preview button. */}
 }
 const projects=[],warnings=[]
 for(const room of crew.conversations || []) {
  if(room.memberBotIds.length<2)continue
  let state
  try{state=await readLifecycle(stateDir,room.id)}catch{warnings.push(`「${room.name}」的归档记录暂不可读`);continue}
  if(state.status!=='archived')continue
  const archivedAt=state.snapshot?.archivedAt || [...state.history].reverse().find(h=>h.action==='archive')?.at || state.updatedAt
  const steps=state.snapshot?.plan?.steps || []
  const files=artifacts.filter(a=>a.conversationId===room.id && (!archivedAt || (a.createdAt && a.createdAt<=archivedAt))).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))
  const groups=new Map()
  for(const file of files){const key=file.sourcePath || file.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(file)}
  const publicFile=f=>({id:f.id,name:f.name,mime:f.mime||'',size:f.size||0,createdAt:f.createdAt||null})
  const outputs=[...groups.values()].map(versions=>({...publicFile(versions[0]),versions:versions.map(publicFile)}))
  const rank=a=>a.mime?.split(';')[0].trim()==='text/html'?0:/^(README|report|design|01-architecture)/i.test(a.name)?1:/\.(md|pdf|zip)$/i.test(a.name)?2:3
  outputs.sort((a,b)=>rank(a)-rank(b)||(b.createdAt||0)-(a.createdAt||0))
  const rows=steps.map(step=>({id:step.id,title:step.title,owner:crew.bots.find(b=>b.id===step.botId)?.name||'历史成员',accepted:acceptedStep(state,step,steps)}))
  projects.push({id:room.id,name:room.name,summary:String(state.summary||'').slice(0,12000),archivedAt,
   accepted:rows.filter(s=>s.accepted).length,total:rows.length,steps:rows,artifacts:outputs,
   members:room.memberBotIds.map(id=>{const b=crew.bots.find(b=>b.id===id);return {id,name:b?.name||'历史成员',avatar:b?.avatar,roleTemplate:b?.roleTemplate}})})
 }
 projects.sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0))
 return {projects,warnings}
}
