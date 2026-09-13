import {sessionEvents} from './session-events.mjs'
// Only native in-flight calls in the current run imply tool execution.
export function characterPhase(events,firstSeq){
 const pending=new Set()
 for(const e of events.slice(-500)){
  if(e.seq<firstSeq)continue
  if(e.type==='tool/call'&&e.data?.callId!=null)pending.add(String(e.data.callId))
  if(e.type==='tool/result'){
   const msg=e.data?.message
   for(const id of [e.data?.callId,msg?.source?.callId,...(Array.isArray(msg?.content)?msg.content.map(b=>b?.toolCallId):[])])if(id!=null)pending.delete(String(id))
  }
 }
 return pending.size?'working':'active'
}

// Native Session.events is immutable per append: acquire the fresh snapshot each read.
export function readCharacterPhase(source){return characterPhase(sessionEvents(source.session),source.firstSeq)}
