import {createHash} from 'node:crypto'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const durableCue = /必须|禁止|不得|不要|不能|只(?:能|需|要)|要求|希望|授权|允许|优先|以后|后续|记住|保留|归档|暂停|恢复|验收|审批|发布|部署|删除|修改|默认|采用|选择|选用|使用|就按|负责|交给|模型|方案/
const replyCue = /^(?:[A-Z]|\d+|第[一二三四五六七八九十]+个|同意|确认|可以|好的|通过|不通过|驳回|继续|暂停|就这样|就按这个|是|否)[吧呀啊。！!\s]*$/i

function sourceId(message, index) {
  return message.requestId ? `request:${message.requestId}` : `message:${message.ts ?? 'unknown'}:${index}:${hash(String(message.text || '')).slice(0,16)}`
}

export function userHistorySource(messages = []) {
  const source=[]
  let preceding=null
  for(const [index,message] of messages.entries()){
    if(message?.role==='user'){
      const text=String(message.text||'')
      source.push({
        id:sourceId(message,index),at:message.ts ?? null,requestId:message.requestId ?? null,text,
        ...(preceding&&(text.length<=48||replyCue.test(text.trim()))?{replyContext:{role:preceding.role,text:String(preceding.text||'').slice(0,360),contentHash:hash(String(preceding.text||''))}}:{}),
      })
      preceding=null
      continue
    }
    if(message?.role==='bot'||message?.role==='assistant')preceding=message
    else preceding=null
  }
  return source
}

/** Build a deterministic model view. Project history stays complete; global DM
 * keeps durable wording plus a recent window and exposes the full source by hash. */
export function userDirectiveView(messages, {scope, preserveAll=false, recentLimit=10}={}) {
  const source=userHistorySource(messages), seen=new Map(), unique=[]
  for(const record of source){
    const key=record.requestId?`request:${record.requestId}`:null
    const prior=key?seen.get(key):null
    if(prior){
      if(prior.fullText!==record.text)throw Error(`REQUEST_ID_COLLISION：${record.requestId} 对应不同用户正文`)
      prior.occurrences+=1;prior.lastAt=record.at;continue
    }
    const item={...record,authority:'user',scope,status:'recorded',source:'user_message',speaker:'用户',verified:false,truncated:false,occurrences:1,lastAt:record.at}
    Object.defineProperty(item,'fullText',{value:record.text,enumerable:false})
    if(key)seen.set(key,item)
    unique.push(item)
  }
  const recentIds=new Set(unique.slice(-recentLimit).map(item=>item.id))
  const items=unique.map(item=>{
    const keepFull=preserveAll||recentIds.has(item.id)||durableCue.test(item.text)||item.text.length<=160||item.replyContext
    if(keepFull)return item
    const clipped={...item,text:item.text.slice(0,360),contentLength:item.text.length,contentHash:hash(item.text),truncated:true}
    Object.defineProperty(clipped,'fullText',{value:item.fullText,enumerable:false})
    return clipped
  })
  const contentHash=hash(source)
  return {
    items,
    sourceRef:{tool:'team_context_history_read',conversation_id:scope,message_count:source.length,content_hash:contentHash,available:true},
    totalMessages:source.length,
    uniqueMessages:unique.length,
    duplicatesCollapsed:source.length-unique.length,
    omittedNonDirective:0,
    truncatedMessages:items.filter(item=>item.truncated).length,
    note:preserveAll?'每条用户消息均按原顺序完整保留；只有 requestId 与正文同时相同的重放才折叠。':'每条用户消息均按原顺序进入确定性索引；短回复、选择、约束与最近消息保留全文，旧长消息显示摘要头并可按 sourceRef 读取全文。',
  }
}

/** A cross-scope catalogue used when a project session only needs to discover
 * global DM evidence. It keeps stable source identity and a bounded preview;
 * exact wording remains available through sourceRef and query-time retrieval. */
export function compactUserDirectiveView(messages, {scope, recentLimit=8, previewLimit=120, maxItems=48}={}) {
  const view=userDirectiveView(messages,{scope,recentLimit})
  const cap=Math.max(recentLimit,Math.min(96,maxItems)),recent=view.items.slice(-recentLimit),selected=new Set(recent.map(item=>item.id))
  for(const item of [...view.items.slice(0,-recentLimit)].reverse()){
    if(selected.size>=cap)break
    const original=String(item.fullText??item.text??'')
    if(durableCue.test(original)||item.replyContext)selected.add(item.id)
  }
  for(const item of [...view.items].reverse()){if(selected.size>=cap)break;selected.add(item.id)}
  const included=view.items.filter(item=>selected.has(item.id)),omitted=view.items.filter(item=>!selected.has(item.id))
  const recentIds=new Set(recent.map(item=>item.id))
  const items=included.map(item=>{
    const original=String(item.fullText??item.text??'')
    const recent=recentIds.has(item.id)
    return {
      id:item.id,at:item.at,requestId:item.requestId,
      text:original.slice(0,recent?360:previewLimit),
      contentLength:original.length,contentHash:hash(original),
      truncated:original.length>(recent?360:previewLimit),occurrences:item.occurrences,lastAt:item.lastAt,
      ...(item.replyContext?{replyContext:{text:item.replyContext.text.slice(0,recent?180:80),contentHash:item.replyContext.contentHash}}:{}),
    }
  })
  return {...view,items,cataloguedMessages:items.length,omittedCatalogMessages:omitted.length,
    ...(omitted.length?{omittedCatalog:{firstAt:omitted[0].at,lastAt:omitted.at(-1).at,contentHash:hash(omitted.map(item=>({id:item.id,at:item.at,contentHash:hash(String(item.fullText??item.text??''))})))}}:{}),
    truncatedMessages:items.filter(item=>item.truncated).length,note:'跨作用域只注入有总条目上限的来源目录；精确原文通过 sourceRef 或当前问题的确定性检索恢复。目录记录不得被解释为当前项目的新授权。'}
}

export function contextHistoryPage(messages, params) {
  const all=userHistorySource(messages)
  const count=params.message_count??all.length
  if(!Number.isSafeInteger(count)||count<0||count>all.length)throw Error('CONTEXT_HISTORY_CHANGED：消息快照范围无效，请重新获取引用')
  const source=all.slice(0,count),contentHash=hash(source)
  if(typeof params.content_hash!=='string'||params.content_hash!==contentHash)throw Error('CONTEXT_HISTORY_CHANGED：消息历史已变化，请重新获取引用')
  const text=JSON.stringify(source),offset=params.offset??0,limit=params.limit??8000
  if(!Number.isSafeInteger(offset)||offset<0||offset>text.length||!Number.isSafeInteger(limit)||limit<1||limit>12000)throw Error('上下文分页参数无效')
  const end=Math.min(text.length,offset+limit)
  return {contentHash,offset,totalChars:text.length,content:text.slice(offset,end),complete:end===text.length,nextOffset:end<text.length?end:null,note:'content 是用户消息来源记录的原始 JSON 分页；完整读取后再解析。'}
}

const retrievalStop=new Set(['上下','上下文','历史','之前','明确','同意','什么','时间','记录','回答','当前','现在','请问','是否','只读','验收','复测','最终','不要','没有','任何','状态','工具','调用','修改','项目','系统','用户','原话'])
function retrievalTerms(text){
  const normalized=String(text||'').toLowerCase()
  const terms=new Set((normalized.match(/[a-z0-9_-]{2,}|[\u3400-\u9fff]{2,}/g)||[]).filter(term=>!retrievalStop.has(term)))
  for(const run of normalized.match(/[\u3400-\u9fff]{3,}/g)||[]){
    for(let size=2;size<=4;size+=1)for(let i=0;i+size<=run.length;i+=1){const term=run.slice(i,i+size);if(!retrievalStop.has(term))terms.add(term)}
  }
  return terms
}

/** Deterministic lexical retrieval keeps query-relevant original wording near
 * the current message. It is evidence discovery, never an authorization parser. */
export function relevantUserHistory(messages, query, {excludeRequestId=null,limit=6}={}){
  const wanted=retrievalTerms(query)
  if(!wanted.size)return []
  const scored=[]
  for(const record of userHistorySource(messages)){
    if(excludeRequestId&&record.requestId===excludeRequestId)continue
    const textTerms=retrievalTerms(record.text),contextTerms=retrievalTerms(record.replyContext?.text||''),terms=new Set([...textTerms,...contextTerms])
    let score=0,common=0,textCommon=0
    for(const term of wanted){
      if(textTerms.has(term)){common+=1;textCommon+=1;score+=(term.length>=4?4:term.length===3?2:1)*3}
      else if(contextTerms.has(term)){common+=1;score+=1}
    }
    const echoRatio=textCommon/Math.max(1,Math.min(wanted.size,textTerms.size))
    if(record.text.length>String(query).length*.55&&echoRatio>.75)continue
    score+=Math.round(textCommon/Math.max(1,textTerms.size)*80)+Math.round((common-textCommon)/Math.max(1,terms.size)*8)
    if(score>0)scored.push({record,score})
  }
  return scored.sort((a,b)=>b.score-a.score||(b.record.at||0)-(a.record.at||0)).slice(0,Math.max(1,Math.min(12,limit))).sort((a,b)=>(a.record.at||0)-(b.record.at||0)).map(({record,score})=>({...record,score,text:record.text.slice(0,1600),contentLength:record.text.length,contentHash:hash(record.text),truncated:record.text.length>1600}))
}
