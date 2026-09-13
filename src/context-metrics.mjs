import {mkdir,readFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {atomicWriteFile} from './inbox.mjs'
import {USAGE_FIELDS} from './work-usage.mjs'
const num=x=>Number.isFinite(x)&&x>=0?x:null
const safe=x=>typeof x==='string'&&/^[\w./-]{1,160}$/.test(x)?x:null
const duration=(a,b)=>a!==null&&b!==null&&b>=a?b-a:null

// Metadata only: never copy prompts, chunks, reasoning, arguments or errors.
export function contextMetrics(events,now=Date.now()) {
 const rows=new Map(),tools=new Map();let model=null,provider=null
 const get=d=>rows.get(`${d.turn}:${d.step}`)
 for(const e of events){
  const d=e.data||{},at=num(e.time)
  if(e.type==='request/header'){model=safe(d.header?.config?.model);provider=safe(d.header?.config?.provider)}
  if(e.type==='step/start'&&!get(d)&&Number.isInteger(d.turn)&&Number.isInteger(d.step))rows.set(`${d.turn}:${d.step}`,{turn:d.turn,step:d.step,startedAt:at,endedAt:null,provider,model,attempts:[{startedAt:at,firstAt:null,endedAt:null,outcome:'pending'}],usage:null,toolMs:0,toolCount:0})
  const r=get(d)
  if(r){
   let a=r.attempts.at(-1)
   if(e.type==='assistant/chunk'&&['block-start','text-delta','reasoning-delta','tool-call-delta'].includes(d.chunk?.type)&&a.firstAt===null)a.firstAt=at
   if(e.type==='llm/retry'){a.endedAt=at;a.outcome=['TIMEOUT','TRANSPORT','SERVER','RATE_LIMIT','EMPTY_RESPONSE'].includes(d.failure?.code)?d.failure.code:'UNKNOWN_ERROR'}
   if(e.type==='llm/retry-started'){r.attempts.push({startedAt:at,firstAt:null,endedAt:null,outcome:'pending'})}
   if(e.type==='assistant/message')r.usage=Object.fromEntries(USAGE_FIELDS.map(k=>[k,num(d.usage?.[k])]))
   if(e.type==='assistant/chunk'&&d.chunk?.type==='finish'){
    a.endedAt=at
    if(a.outcome==='pending')a.outcome=['completed','stop'].includes(d.chunk.reason?.kind)?'completed':d.chunk.reason?.kind==='cancelled'?'cancelled':'ended'
   }
   if(e.type==='step/end'){r.endedAt=at;if(a.endedAt===null)a.endedAt=at}
  }
  if(e.type==='tool/call'&&r)tools.set(d.callId,{at,row:r})
  if(e.type==='tool/result'){
   const id=d.message?.source?.callId??d.callId,t=tools.get(id)
   if(t){const ms=duration(t.at,at);if(ms!==null){t.row.toolMs+=ms;t.row.toolCount++}tools.delete(id)}
  }
 }
 return [...rows.values()].map(r=>{
  const known=r.usage?[r.usage.inputTokens,r.usage.cacheReadTokens,r.usage.cacheWriteTokens].filter(v=>v!==null):[]
  const first=r.attempts.find(a=>a.firstAt!==null)?.firstAt??null
  return {...r,inputReported:known.length?known.reduce((a,b)=>a+b,0):null,inputFieldsReported:r.usage?['inputTokens','cacheReadTokens','cacheWriteTokens'].filter(k=>r.usage[k]!==null):[],firstResponseMs:duration(r.startedAt,first),elapsedMs:duration(r.startedAt,r.endedAt??now),retryCount:Math.max(0,r.attempts.length-1),attempts:r.attempts.map(a=>({...a,firstResponseMs:duration(a.startedAt,a.firstAt),elapsedMs:duration(a.startedAt,a.endedAt??now)}))}
 })
}
export async function saveContextMetrics(stateDir,botId,sessionId,events){
 if(!/^[\w-]+$/.test(botId)||!/^[a-f0-9-]{36}$/i.test(sessionId))throw Error('指标归属无效')
 const dir=join(stateDir,'context-metrics',botId);await mkdir(dir,{recursive:true})
 const calls=contextMetrics(events),record={schema:1,botId,sessionId,updatedAt:Date.now(),totalObserved:calls.length,calls:calls.slice(-1000)}
 await atomicWriteFile(join(dir,sessionId+'.json'),JSON.stringify(record)+'\n')
 return record
}
export async function readContextMetrics(stateDir,botId){
 if(!/^[\w-]+$/.test(botId))throw Error('指标归属无效')
 const dir=join(stateDir,'context-metrics',botId)
 let names
 try{names=await readdir(dir)}catch(e){if(e.code==='ENOENT')return {calls:[],sessions:0,scope:'尚无采样；历史缺失不补造'};throw e}
 const records=[]
 for(const name of names.filter(n=>/^[a-f0-9-]{36}\.json$/i.test(n))){
  try{const r=JSON.parse(await readFile(join(dir,name),'utf8'));if(r.schema===1&&r.botId===botId&&r.sessionId+'.json'===name&&Array.isArray(r.calls))records.push(r)}catch{}
 }
 records.sort((a,b)=>b.updatedAt-a.updatedAt)
 const selected=records.slice(0,200),calls=selected.flatMap(r=>r.calls.map(c=>({...c,sessionId:r.sessionId,observedAt:r.updatedAt}))).sort((a,b)=>(b.startedAt||0)-(a.startedAt||0))
 const times=calls.map(c=>c.firstResponseMs).filter(v=>v!==null).sort((a,b)=>a-b)
 return {calls:calls.slice(0,100),sessions:selected.length,observedCalls:calls.length,firstResponseP50Ms:times.length?times[Math.floor((times.length-1)*.5)]:null,firstResponseP95Ms:times.length?times[Math.ceil(times.length*.95)-1]:null,retryCount:calls.reduce((n,c)=>n+c.retryCount,0),scope:'最近更新的 200 个已采样会话，每会话最多 1000 步；展示最近 100 步。首响应为首内容事件，包含重试等待；失败请求 token 未知。输入为已报告字段之和，非账单。'}
}
