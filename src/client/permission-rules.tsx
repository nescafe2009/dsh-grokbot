import {useEffect,useState} from 'react'
type Rule={id:string;botId:string;workspace:string;conversationId:string;mode:string;commandPreview:string;expiresAt:number}
export function PermissionRules({api,bots,onBack}:{api:(path:string,init?:RequestInit)=>Promise<any>;bots:{id:string;name:string}[];onBack:()=>void}){
 const [rules,setRules]=useState<Rule[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState('')
 useEffect(()=>{let alive=true;api('/approval-rules').then(r=>{if(alive)setRules(r.rules)}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[api])
 const revoke=async(id:string)=>{setBusy(id);setError('');try{await api('/approval-rules/'+id,{method:'DELETE'});setRules(rows=>rows?.filter(r=>r.id!==id)||[])}catch(e){setError((e as Error).message)}finally{setBusy('')}}
 return <section className="gk-permissions"><button onClick={onBack}>← 返回首页</button><h1>授权规则</h1><p>你明确记住的操作，在 24 小时内按相同成员、会话、工作目录、完整命令和权限复用。命令执行的脚本内容仍可能变化。</p><p>撤销后，下次匹配的操作重新询问；已获准运行的操作不会因此中止。</p>{error?<p role="alert">{error}</p>:null}{rules===null?<p>{error?'读取失败，请返回后重试。':'正在读取…'}</p>:!rules.length?<p>没有已保存的规则。在审批卡中勾选“24 小时内记住此操作”后，这里会显示可撤销的授权。</p>:rules.map(rule=><article key={rule.id}><header><strong>{bots.find(b=>b.id===rule.botId)?.name||rule.botId}</strong><button disabled={Boolean(busy)} onClick={()=>void revoke(rule.id)}>{busy===rule.id?'撤销中…':'撤销'}</button></header><small>{rule.workspace}<br/>会话：{rule.conversationId} · 权限：{rule.mode}<br/>有效至 {new Date(rule.expiresAt).toLocaleString()}</small><pre>{rule.commandPreview}</pre></article>)}</section>
}
