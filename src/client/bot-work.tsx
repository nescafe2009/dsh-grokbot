import {useEffect,useState} from 'react'
import type {ReactNode} from 'react'

type Activity={id:string;at:number;kind:string;name?:string;callId:string;text:string;failed?:boolean}
type Work={id:string;title:string;project:string;status:string;createdAt:number;startedAt:number|null;endedAt:number|null;lastActivityAt:number|null;stale:boolean;observation?:string;activeTools:string[];reason:string;from:string;request:string;reply:string;checkpoint:null|{completed:string;validation:string;remaining:string;blockers:string;files:string[]};activity:Activity[]}
type Snapshot={conversations?:{id:string;title:string;activity:Activity[]}[];botId:string;observedAt:number;jobs:Work[];recordScope:string;live?:{status:string}}
let requestedBot:string|null=null
export function focusBotWork(botId:string){requestedBot=botId}
const labels:Record<string,string>={pending:'等待调度',running:'正在执行',queued:'等待执行',replied:'已交付',cancelled:'已取消',failed:'执行失败',interrupted:'执行中断，待核对'}
const when=(at:number|null)=>at?new Date(at).toLocaleString():'尚无记录'
function age(at:number|null,now:number){if(!at)return '尚未开始';const s=Math.max(0,Math.floor((now-at)/1000));return s<60?`${s} 秒`:`${Math.floor(s/60)} 分钟`}
export function BotWorkPanel({botId,botName}:{botId:string;botName:string}):ReactNode {
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[expanded,setExpanded]=useState(false)
 useEffect(()=>{setSnapshot(null);setExpanded(requestedBot===botId);if(requestedBot===botId)requestedBot=null},[botId])
 useEffect(()=>{
  let stopped=false,timer:ReturnType<typeof setTimeout>;const controller=new AbortController()
  setError('')
  const poll=async()=>{
   try {const response=await fetch(`/api/plugins/grokbot/bots/${encodeURIComponent(botId)}/work?detail=${expanded?'1':'0'}`,{signal:controller.signal});if(!response.ok)throw Error('工作记录暂时无法刷新');const next=await response.json();if(!stopped){setSnapshot(next);setError('')}}catch(e){if(!stopped)setError(String((e as Error).message))}
   if(!stopped)timer=setTimeout(()=>{if(document.hidden){timer=setTimeout(poll,10000)}else void poll()},5000)
  };void poll();return()=>{stopped=true;controller.abort();clearTimeout(timer)}
 },[botId,expanded])
 const data=snapshot?.botId===botId?snapshot:null
 const active=data?.jobs.filter(j=>j.status==='running'||j.status==='queued')||[]
 const now=data?.observedAt||Date.now()
 return <section aria-label={`${botName}工作详情`} className="gk-work" style={{padding:'12px 20px',borderBottom:'1px solid var(--gk-line)',flexShrink:0,maxHeight:expanded?'65%':undefined,overflowY:'auto'}}>
  <button type="button" onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded} style={{width:'100%',textAlign:'left',background:'transparent',color:'inherit',border:0,cursor:'pointer'}}>
   {expanded?'▾':'▸'} 执行进展 · {active.length?`${labels[active[0].status]} · ${active[0].title}`:data?.live?.status==='working'?'正在处理会话':data?'当前没有执行中的派工任务':'正在读取实际状态…'}
  </button>
  {active[0]?<div><small>{active[0].project ? `${active[0].project} · ` : ''}耗时 {age(active[0].startedAt,now)} · 最近活动 {when(active[0].lastActivityAt)}{active[0].stale ? ' · 采样已过期' : ''}</small></div>:null}
  {error?<div role="status">{error} · 保留上次记录，状态可能已过期</div>:null}
  {expanded&&data?<div>
   <small>更新于 {when(data.observedAt)} · {data.recordScope}</small>
   {data.conversations?.map(c=><details key={c.id}><summary>{c.title} · 会话执行记录</summary><ExecutionTimeline activity={c.activity}/></details>)}
   {!data.jobs.length?<p>尚无派工记录。会话消息显示在下方。</p>:null}
   {data.jobs.map((j,i)=><details key={j.id} open={i===0} style={{marginTop:10,borderTop:'1px solid var(--gk-line)',paddingTop:8}}>
    <summary>{labels[j.status]||j.status} · {j.project?`${j.project} / `:''}{j.title}</summary>
    <p>开始：{when(j.startedAt)} · 耗时：{age(j.startedAt,j.endedAt||now)}<br/>最近活动：{when(j.lastActivityAt)} {j.stale?'（进度采样已过期，等待刷新）':''}</p>
    {j.status==='running'?<p>{j.observation==='awaiting-approval'?'等待审批':j.activeTools.length?`等待工具返回：${j.activeTools.join('、')}`:j.observation==='quiet'?'暂时没有新的可见活动':'执行器正在运行'}</p>:null}
    {j.reason?<p>{j.reason}</p>:null}
    <details><summary>派工与交付（实际记录）</summary><p>{j.from} → {botName} · {when(j.createdAt)}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{j.request}</pre>{j.reply?<><p>{botName} → {j.from} · {when(j.endedAt)}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{j.reply}</pre></>:<p>尚无交付回复</p>}</details>
    {j.checkpoint?<details><summary>工作检查点（Bot 自报，未独立核验）</summary>{(['completed','validation','remaining','blockers'] as const).map((k,n)=><p key={k}>{['已完成','验证','剩余','阻塞'][n]}：{j.checkpoint![k]||'未报告'}</p>)}<pre style={{whiteSpace:'pre-wrap'}}>{j.checkpoint.files.join('\n')}</pre></details>:null}
    <ExecutionTimeline activity={j.activity}/>

   </details>)}
  </div>:null}
 </section>
}

export function ExecutionTimeline({activity}:{activity:Activity[]}):ReactNode {
 const rows=activity.filter(a=>a.kind!=='result'||!activity.some(c=>c.kind==='call'&&c.callId&&c.callId===a.callId))
 return <section className="gk-execution" aria-label="执行过程"><h4>执行过程</h4>
  {!rows.length?<p>尚无已保存的执行事件。旧任务不会补造记录。</p>:rows.map((a,i)=>{
   const result=a.kind==='call'?activity.find(r=>r.kind==='result'&&r.callId===a.callId):null
   if(a.kind==='progress')return <div className="gk-execution__progress" key={a.id+':'+i}><time>{when(a.at)}</time><p>{a.text}</p></div>
   return <details className="gk-execution__tool" key={a.id+':'+i}>
    <summary><span>{a.name||'工具结果'}</span><span className="gk-execution__state">{(result||a).failed?'执行出错':result?'已返回':a.kind==='call'?'等待结果':'已返回'}</span><time>{when(a.at)}</time></summary>
    <p>输入</p><pre>{a.text||'未保存输入'}</pre>
    {result?<><p>输出</p><pre>{result.text||'工具未返回文本'}</pre></>:null}
   </details>
  })}
 </section>
}
