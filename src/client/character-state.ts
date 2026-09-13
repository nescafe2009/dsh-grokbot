export type CharacterState='idle'|'active'|'working'|'waiting'|'queued'|'done'|'error'|'paused'|'unknown'
export type CharacterActivity={state:CharacterState;eventId?:string;label:string}
type Bot={id:string;status:string;motionPhase?:'active'|'working';lastAt?:number|null;lastFrom?:string;currentJob?:string|null}
type Snapshot={stale?:boolean;approvals:{botId:string;stage?:string}[];queued:{botId:string}[];recentJobs:{botId:string;jobId:string;status:string;endedAt:number|null}[]}
export function characterActivity(bot:Bot,snapshot:Snapshot|null,now=Date.now()):CharacterActivity{
 if(!snapshot||snapshot.stale)return {state:'unknown',label:'状态待同步'}
 const approval=snapshot.approvals?.find(a=>a.botId===bot.id)
 if(approval)return {state:'waiting',label:approval.stage==='chief'?'等待幕僚长审核':'等待你审批'}
 if(bot.status==='working')return {state:bot.motionPhase==='working'?'working':'active',label:bot.motionPhase==='working'?'工具执行中':'正在处理',eventId:bot.currentJob||undefined}
 if(snapshot.queued?.some(j=>j.botId===bot.id))return {state:'queued',label:'等待调度'}
 const recent=snapshot.recentJobs?.find(j=>j.botId===bot.id)
 if(recent?.endedAt&&now-recent.endedAt<15000&&!(bot.lastFrom==='user'&&(bot.lastAt||0)>recent.endedAt)){
  if(['replied','done','completed'].includes(recent.status))return {state:'done',label:'本次执行已结束',eventId:recent.jobId}
  if(['failed','interrupted'].includes(recent.status))return {state:'error',label:'执行受阻，查看详情',eventId:recent.jobId}
  if(recent.status==='cancelled')return {state:'paused',label:'本次执行已取消',eventId:recent.jobId}
 }
 return {state:'idle',label:'待命'}
}
