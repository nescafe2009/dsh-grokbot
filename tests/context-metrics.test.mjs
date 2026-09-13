import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {contextMetrics,saveContextMetrics,readContextMetrics} from '../src/context-metrics.mjs'
const ev=(type,time,data={})=>({type,time,data:{turn:1,step:1,...data}})
test('per-attempt timing distinguishes timeout, retry and first content; no raw content survives',()=>{
 const events=[ev('request/header',0,{header:{config:{provider:'p',model:'m'},system:'SECRET'}}),ev('step/start',100),ev('llm/retry',300100,{failure:{code:'TIMEOUT',message:'SECRET'}}),ev('llm/retry-started',301100),ev('assistant/chunk',302100,{chunk:{type:'reasoning-delta',text:'SECRET'}}),ev('assistant/chunk',303100,{chunk:{type:'finish',reason:{kind:'completed'}}}),ev('assistant/message',303100,{usage:{inputTokens:2,cacheReadTokens:10,outputTokens:3}}),ev('tool/call',303100,{callId:'x',arguments:'SECRET'}),ev('tool/result',303150,{message:{source:{callId:'x'},content:'SECRET'}}),ev('step/end',303160)]
 const [r]=contextMetrics(events)
 assert.equal(r.firstResponseMs,302000);assert.equal(r.attempts[0].firstResponseMs,null)
 assert.equal(r.attempts[1].firstResponseMs,1000);assert.equal(r.attempts[0].outcome,'TIMEOUT')
 assert.equal(r.retryCount,1);assert.equal(r.toolMs,50);assert.equal(r.inputReported,12)
 assert.equal(r.usage.reasoningTokens,null);assert.equal(r.model,'m')
 assert.doesNotMatch(JSON.stringify(r),/SECRET|arguments/)
})
test('failure without usage remains unknown; revisions do not double count and model changes are per step',()=>{
 const events=[ev('step/start',10),ev('step/start',10),ev('step/end',100),ev('request/header',101,{header:{config:{provider:'new',model:'other'}}}),ev('step/start',102,{step:2}),ev('assistant/message',103,{step:2,usage:{inputTokens:5}}),ev('assistant/message',104,{step:2,usage:{inputTokens:6}})]
 const [a,b]=contextMetrics(events,110)
 assert.equal(a.inputReported,null);assert.equal(a.firstResponseMs,null);assert.equal(a.usage,null)
 assert.equal(b.inputReported,6);assert.equal(b.model,'other');assert.equal(b.endedAt,null)
 assert.equal(b.elapsedMs,8)
})
test('persistent metrics are idempotent across sampling and readable after restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'context-metrics-')),id='11111111-1111-4111-8111-111111111111'
 try{
  const events=[ev('step/start',100),ev('assistant/message',200,{usage:{inputTokens:5}}),ev('step/end',210)]
  await saveContextMetrics(dir,'chief',id,events);await saveContextMetrics(dir,'chief',id,events)
  const r=await readContextMetrics(dir,'chief');assert.equal(r.sessions,1);assert.equal(r.observedCalls,1)
  assert.equal(r.calls[0].inputReported,5);assert.equal(r.firstResponseP50Ms,null)
  assert.equal((await readContextMetrics(dir,'qa')).calls.length,0)
  await assert.rejects(readContextMetrics(dir,'../secret'),/归属无效/)
 }finally{await rm(dir,{recursive:true,force:true})}
})
