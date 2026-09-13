import test from 'node:test'
import assert from 'node:assert/strict'
import {workUsage} from '../src/work-usage.mjs'
const row=(seq,turn,step,usage)=>({seq,type:'assistant/message',data:{turn,step,usage,message:{content:'private'}}})
test('assembled usage deduplicates revisions and keeps cache separate',()=>{
 const r=workUsage([row(1,1,1,{inputTokens:10}),{seq:2,type:'assistant/usage',data:{inputTokens:999}},row(3,1,1,{inputTokens:12,cacheReadTokens:100,outputTokens:4,totalTokens:116}),row(4,1,2,{inputTokens:0,cacheReadTokens:50,outputTokens:2,totalTokens:52})])
 assert.equal(r.observedSteps,2);assert.equal(r.fields.inputTokens.sumReported,12);assert.equal(r.fields.cacheReadTokens.sumReported,150);assert.equal(r.fields.totalTokens.sumReported,168)
 assert.equal(r.fields.inputTokens.completeForObservedSteps,true);assert.equal(r.fields.reasoningTokens.sumReported,null)
 assert.doesNotMatch(JSON.stringify(r),/private|999/)
})
test('missing invalid and unidentified usage stays unknown rather than zero',()=>{
 const r=workUsage([row(1,1,1,{inputTokens:0,outputTokens:-1}),row(2,1,2,{inputTokens:'30'}),{type:'assistant/message',data:{usage:{inputTokens:99}}}])
 assert.equal(r.fields.inputTokens.sumReported,0);assert.equal(r.fields.inputTokens.reportedSteps,1);assert.equal(r.fields.inputTokens.completeForObservedSteps,false)
 assert.equal(r.fields.outputTokens.sumReported,null);assert.equal(r.unidentifiedMessages,1)
 assert.equal(workUsage([]).fields.inputTokens.sumReported,null)
})
