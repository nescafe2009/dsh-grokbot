/** Observation only: elapsed time and silence never grant authority to cancel. */
export class JobProgress {
 constructor({now=()=>Date.now(),idleWarningMs=900000,reviewAfterMs=1800000}={}){
  this.now=now;this.idleWarningMs=idleWarningMs;this.reviewAfterMs=reviewAfterMs
  this.startedAt=now();this.lastActivityAt=this.startedAt;this.cursor=0;this.tools=new Map();this.observation='';this.lastNotice='';this.lastNoticeAt=-Infinity
 }
 observe(events,{approval=false}={}){
  const now=this.now()
  for(;this.cursor<events.length;this.cursor++){
   const e=events[this.cursor],d=e.data||{}
   if(e.type==='tool/call')this.tools.set(String(d.callId),String(d.name||'tool'))
   if(e.type==='tool/result')this.tools.delete(String(d.message?.source?.callId??d.callId))
   if(['assistant/chunk','assistant/message','tool/call','tool/result'].includes(e.type))this.lastActivityAt=now
  }
  if(approval)this.lastActivityAt=now
  const silenceMs=now-this.lastActivityAt
  this.observation=approval?'awaiting-approval':this.tools.size?'awaiting-tool':silenceMs>=this.idleWarningMs?'quiet':'active'
  const reviewNeeded=!approval&&(silenceMs>=this.idleWarningMs||now-this.startedAt>=this.reviewAfterMs)
  const noticeKey=reviewNeeded?this.observation:''
  const notify=!!noticeKey&&noticeKey!==this.lastNotice&&now-this.lastNoticeAt>=Math.min(this.idleWarningMs,this.reviewAfterMs)
  if(notify){this.lastNotice=noticeKey;this.lastNoticeAt=now}
  if(!noticeKey)this.lastNotice=''
  return {startedAt:this.startedAt,lastActivityAt:this.lastActivityAt,elapsedMs:now-this.startedAt,silenceMs,observation:this.observation,activeTools:[...this.tools.values()],reviewNeeded,notify,autoStopped:false}
 }
}
export const LONG_TASK_RULES=`【持续任务执行约定】
一次派发只完成一个可独立验收的工作单元（一个模块/行为和对应验证），不是一次完成整个端或整个工程。阶段计划可以很大，执行单元必须具体。
先检查现有文件与检查点，不覆盖已有成果，不重复已完成工作。每完成一个有意义的里程碑或准备结束时，调用 task_checkpoint 保存：已完成内容、文件路径、已执行的验证、阻塞和下一步；这些是待核实的交接记录，不是验收通过。
若任务过大，先完成一个有用的小单元并记录剩余拆分，向幕僚长汇报，不能把整体标成完成。任务运行时间长不是失败，也不必为赶时限草率交付。等待审批时不要绕过审批；等待工具时不要重复启动同一操作。
最终回复明确区分已完成、未完成、验证通过/失败/未运行；不以过程文字代替交付。`;
export function checkpointRecord(input,{jobId,botId,now=Date.now()}={}){
 const out={jobId,botId,updatedAt:now,verified:false}
 for(const key of ['completed','validation','remaining','blockers']){
  if(typeof input?.[key]!=='string')throw Error(`检查点字段 ${key} 必须是文本（无内容请传空字符串）`)
  if(input[key].length>6000)throw Error(`检查点字段 ${key} 超过6000字符，请压缩该字段`)
  out[key]=input[key].trim()
 }
 if(!out.completed&&!out.remaining)throw Error('检查点必须说明已完成或剩余工作')
 if(!Array.isArray(input.files)||input.files.length>50||input.files.some(x=>typeof x!=='string'||x.length>1000))throw Error('文件路径列表无效')
 out.files=input.files;return out
}
