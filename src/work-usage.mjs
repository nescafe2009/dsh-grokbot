// Provider accounting only. Never retain message bodies or raw usage payloads.
export const USAGE_FIELDS = ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','reasoningTokens','totalTokens']
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null
export function usageView(record,jobId,botId){
 if(record?.schema!==1||record.jobId!==jobId||record.botId!==botId)return null
 const observedSteps=count(record.observedSteps),unidentifiedMessages=count(record.unidentifiedMessages)
 if(observedSteps===null||unidentifiedMessages===null)return null
 return {schema:1,scope:'assembled-assistant-messages',observedSteps,unidentifiedMessages,updatedAt:count(record.updatedAt),
  nativeSessionId:/^[a-f0-9-]{36}$/i.test(record.nativeSessionId||'')?record.nativeSessionId:null,
  fields:Object.fromEntries(USAGE_FIELDS.map(k=>{
   const source=record.fields?.[k],reportedSteps=count(source?.reportedSteps),sumReported=count(source?.sumReported)
   return [k,{reportedSteps,sumReported,completeForObservedSteps:source?.completeForObservedSteps===true&&observedSteps>0&&reportedSteps===observedSteps&&sumReported!==null&&unidentifiedMessages===0}]
  }))}
}
export function workUsage(events) {
 const steps=new Map()
 let unidentifiedMessages=0
 for(const event of events){
  if(event.type!=='assistant/message')continue
  const {turn,step,usage}=event.data||{}
  if(count(turn)===null||count(step)===null||count(event.seq)===null){unidentifiedMessages++;continue}
  const key=`${turn}:${step}`,old=steps.get(key)
  if(!old||event.seq>old.seq)steps.set(key,{seq:event.seq,values:Object.fromEntries(USAGE_FIELDS.map(k=>[k,count(usage?.[k])]))})
 }
 const values=[...steps.values()]
 return {schema:1,scope:'assembled-assistant-messages',observedSteps:values.length,unidentifiedMessages,
  fields:Object.fromEntries(USAGE_FIELDS.map(k=>{
   const known=values.map(v=>v.values[k]).filter(v=>v!==null)
   const total=known.reduce((a,b)=>a+b,0)
   return [k,{reportedSteps:known.length,sumReported:known.length&&Number.isSafeInteger(total)?total:null,completeForObservedSteps:values.length>0&&known.length===values.length&&Number.isSafeInteger(total)&&unidentifiedMessages===0}]
  }))}
}
