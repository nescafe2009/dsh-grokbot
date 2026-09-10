import test from 'node:test'
import assert from 'node:assert/strict'
import {JobProgress,checkpointRecord} from '../src/job-progress.mjs'
test('productive execution can run for hours without an automatic stop',()=>{
 let now=0;const p=new JobProgress({now:()=>now}),events=[]
 for(let i=0;i<480;i++){
  now+=60000;events.push({type:'assistant/chunk',data:{}})
  const s=p.observe(events);assert.equal(s.observation,'active');assert.equal(s.autoStopped,false)
 }
 assert.equal(p.observe(events).elapsedMs,8*3600000)
})
test('silence is reported once, renewed progress resets notice, retries are not progress',()=>{
 let now=0;const p=new JobProgress({now:()=>now,idleWarningMs:100,reviewAfterMs:10000})
 now=101;assert.equal(p.observe([{type:'llm/retry-started'}]).notify,true)
 assert.equal(p.observe([{type:'llm/retry-started'}]).notify,false)
 const events=[{type:'llm/retry-started'},{type:'tool/result',data:{callId:'x'}}]
 assert.equal(p.observe(events).observation,'active');now=202;assert.equal(p.observe(events).notify,true)
})
test('approvals and long tools are distinct from silence and never cancelled',()=>{
 let now=0;const p=new JobProgress({now:()=>now,idleWarningMs:100,reviewAfterMs:200}),events=[{type:'tool/call',data:{callId:'c',name:'bash'}}]
 p.observe(events);now=1000
 assert.equal(p.observe(events).observation,'awaiting-tool');assert.equal(p.observe(events).autoStopped,false)
 const a=p.observe(events,{approval:true});assert.equal(a.observation,'awaiting-approval');assert.equal(a.notify,false)
 now=1050;events.push({type:'tool/result',data:{message:{source:{callId:'c'}}}})
 assert.equal(p.observe(events).observation,'active')
})
test('checkpoint records explicit unverified progress and rejects malformed input',()=>{
 const input={completed:'codec',files:['src/codec.cpp'],validation:'unit tests passed',remaining:'network layer',blockers:''}
 const c=checkpointRecord(input,{jobId:'j',botId:'b',now:123});assert.equal(c.verified,false);assert.equal(c.remaining,'network layer');assert.equal(c.updatedAt,123)
 assert.throws(()=>checkpointRecord({...input,files:['x'.repeat(1001)]}),/无效/)
 assert.throws(()=>checkpointRecord({...input,remaining:null}),/字段/)
})


test('tool/output transitions on a long task do not cause repeated notices',()=>{
 let now=0;const p=new JobProgress({now:()=>now,idleWarningMs:100,reviewAfterMs:200}),events=[]
 now=201;events.push({type:'assistant/chunk'});assert.equal(p.observe(events).notify,true)
 now=210;events.push({type:'tool/call',data:{callId:'x',name:'bash'}});assert.equal(p.observe(events).notify,false)
 now=220;events.push({type:'tool/result',data:{callId:'x'}});assert.equal(p.observe(events).notify,false)
})
