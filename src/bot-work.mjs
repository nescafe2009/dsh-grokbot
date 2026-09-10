import { open } from 'node:fs/promises'
import { join } from 'node:path'

const validId = id => /^[A-Za-z0-9_-]+$/.test(id)
// Never follow queue-provided directories or expose opaque event payloads / reasoning.
export function workText(value, limit = 4000) {
 return String(value ?? '').replace(/\b(Bearer\s+)[^\s"']+/gi,'$1[已隐藏]')
  .replace(/\b((?:api[_-]?key|token|password|secret|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi,'$1[已隐藏]')
  .replace(/\bsk-[A-Za-z0-9_-]{12,}/g,'[已隐藏]').slice(0,limit)
}
async function tail(path, bytes=262144) {
 let f
 try { f=await open(path,'r');const {size}=await f.stat();const b=Buffer.alloc(Math.min(size,bytes));await f.read(b,0,b.length,Math.max(0,size-bytes));const s=b.toString('utf8');return size>bytes?s.slice(s.indexOf('\n')+1):s } catch(e) { if(e.code==='ENOENT')return '';throw e } finally { await f?.close() }
}
async function json(path) { try { const s=await tail(path,524288);return s?JSON.parse(s):null } catch { return null } }
export function workActivity(events, start=0, now=Date.now()) {
 const rows=[]
 for(const e of events.slice(start)) {
  const d=e.data||{}
  if(e.type==='tool/call') {
   const args=d.arguments??d.input??d.args
   let a=args;if(typeof a==='string'){try{a=JSON.parse(a)}catch{a={command:a}}}
   rows.push({id:String(e.seq??rows.length),at:now,kind:'call',name:workText(d.name,120),callId:String(d.callId??''),text:workText(a?.command??a?.cmd??a?.path??a?.file_path??'',2000)})
  } else if(e.type==='tool/result') {
   const blocks=Array.isArray(d.message?.content)?d.message.content:[]
   const text=blocks.filter(b=>b.type==='tool-result').map(b=> typeof b.content==='string'?b.content:Array.isArray(b.content)?b.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'):typeof b.text==='string'?b.text:'').join('\n')
   rows.push({id:String(e.seq??rows.length),at:now,kind:'result',callId:String(d.message?.source?.callId??d.callId??blocks[0]?.toolCallId??''),failed:!!d.error||blocks.some(b=>b.isError),text:workText(text,4000)})
  }
 }
 return rows.slice(-80)
}
export async function botWork({stateDir,inboxRoot,botId,bots=[],conversations=[],runningIds=[],queuedIds=[],live=null,details=true,now=Date.now()}) {
 if(!validId(botId))throw Error('Bot 标识无效')
 const running=new Set(runningIds),queued=new Set(queuedIds),entries=new Map()
 for(const line of (await tail(join(inboxRoot,'queue.jsonl'),2*1024*1024)).split('\n')) {try{const j=JSON.parse(line);if(validId(j.jobId)&&j.toBot===botId)entries.set(j.jobId,j)}catch{}}
 for(const id of new Set([...runningIds,...queuedIds])){if(validId(id)&&!entries.has(id)){const j=await json(join(inboxRoot,id,'job.json'));if(j?.toBot===botId)entries.set(id,{...j,jobId:id})}}
 const all=[...entries.values()].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))
 const selected=[...all.filter(j=>running.has(j.jobId)||queued.has(j.jobId)),...all].filter((j,i,a)=>a.findIndex(k=>k.jobId===j.jobId)===i).slice(0,25)
 const plans=new Map()
 for(const id of new Set(selected.map(j=>j.conversationId).filter(id=>validId(id||''))))plans.set(id,await json(join(stateDir,'project-plans',`${id}.json`)))
 const jobs=await Promise.all(selected.map(async j=>{
  const dir=join(inboxRoot,j.jobId)
  const [status,progress,checkpoint,activity,reply]=await Promise.all([json(join(dir,'status.json')),json(join(dir,'progress.json')),details?json(join(dir,'checkpoint.json')):null,details?json(join(dir,'activity.json')):null,details?tail(join(dir,'reply.md'),16384):''])
  const actual=running.has(j.jobId)?'running':queued.has(j.jobId)?'queued':status?.status==='claimed'?'interrupted':status?.status==='queued'||!status?.status?'pending':status.status
  const stage=plans.get(j.conversationId)?.steps?.find(s=>s.id===j.projectStep?.id||s.jobIds?.includes(j.jobId))
  return {id:j.jobId,title:workText(stage?.title||j.text||'任务',160),project:workText(conversations.find(c=>c.id===j.conversationId)?.name||'',120),status:actual,createdAt:j.createdAt||null,startedAt:status?.startedAt||null,endedAt:status?.endedAt||null,lastActivityAt:progress?.lastActivityAt||status?.endedAt||status?.startedAt||j.createdAt||null,stale:actual==='running'&&(!progress?.updatedAt||now-progress.updatedAt>60000),observation:actual==='running'?progress?.observation:null,activeTools:actual==='running'?(progress?.activeTools||[]).map(x=>workText(x,120)):[],reason:workText(status?.reason||status?.error||''),from:workText(bots.find(b=>b.id===j.fromBotId)?.name||j.fromBotId||'任务入口',120),request:details?workText(j.text,12000):'',reply:workText(reply,12000),checkpoint:checkpoint?{updatedAt:checkpoint.updatedAt,completed:workText(checkpoint.completed),validation:workText(checkpoint.validation),remaining:workText(checkpoint.remaining),blockers:workText(checkpoint.blockers),files:(checkpoint.files||[]).slice(0,50).map(p=>workText(p,1000))}:null,activity:Array.isArray(activity)?activity.slice(-80):[]}
 }))
 jobs.sort((a,b)=>Number(['running','queued'].includes(b.status))-Number(['running','queued'].includes(a.status))||(b.createdAt||0)-(a.createdAt||0))
 return {botId,observedAt:now,live:live?{status:live.status,lastActivity:live.lastActivity,conversationId:live.currentConversationId}:null,jobs,limited:all.length>25,recordScope:'最近 25 项任务；每项最近 80 条工具事件。旧任务未保存工具事件时不补造记录。'}
}
