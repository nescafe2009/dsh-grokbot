import test from 'node:test'
import assert from 'node:assert/strict'
import {contextDecisionManifest, contextEventIntegrity, compactWithDecisionGuard} from '../src/context-maintenance.mjs'

const call = id => ({type:'tool/call',data:{callId:id}})
const result = id => ({type:'tool/result',data:{message:{source:{callId:id},content:[{type:'tool-result',toolCallId:id}]}}})

test('event integrity accepts paired tools and rejects open, orphan and duplicate results', () => {
  assert.equal(contextEventIntegrity([call('a'),result('a')]).ok,true)
  assert.deepEqual(contextEventIntegrity([call('a')]).unmatchedCalls,['a'])
  assert.deepEqual(contextEventIntegrity([result('a')]).orphanResults,['a'])
  assert.deepEqual(contextEventIntegrity([call('a'),result('a'),result('a')]).duplicateResults,['a'])
  assert.equal(contextEventIntegrity([{type:'tool/call',data:{callId:0}},{type:'tool/result',data:{callId:0}}]).ok,true)
  assert.equal(contextEventIntegrity([{type:'tool/call',data:{}},{type:'tool/result',data:{}}]).ok,false)
  assert.equal(contextEventIntegrity([call('a'),{type:'tool/result',data:{callId:'a',message:{source:{callId:'b'}}}}]).ok,false)
})

test('decision manifest ignores metrics but changes with authorization and task state', () => {
  const base={projectIndex:[{id:'p'}],projects:[{id:'p',lifecycle:{revision:1},tasks:[{id:'x',status:'running'}],userInstructions:[{text:'禁止发布'}]}]}
  assert.equal(contextDecisionManifest({...base,contextBudget:{chars:9}}).hash,contextDecisionManifest({...base,contextBudget:{chars:10}}).hash)
  assert.notEqual(contextDecisionManifest(base).hash,contextDecisionManifest({...base,projects:[{...base.projects[0],lifecycle:{revision:2}}]}).hash)
  assert.notEqual(contextDecisionManifest(base).hash,contextDecisionManifest({...base,recentChiefConversation:[{text:'允许发布'}]}).hash)
  assert.throws(()=>contextDecisionManifest({...base,projects:[{id:'p',error:'read failed'}]}),/AUTHORITY_INCOMPLETE/)
})

test('native compaction runs only when idle and preserves the authority manifest', async () => {
  const order=[],brief={projectIndex:[{id:'p'}],projects:[{id:'p',lifecycle:{revision:3},tasks:[],userInstructions:[]}]}
  const compacted=await compactWithDecisionGuard({agent:{whenIdle:async()=>order.push('idle')},compaction:{compactNow:async()=>{order.push('compact');return {shadowedSeqs:[1,2],shadowedTokenCount:1200,summarySeq:9}}},signal:new AbortController().signal,sourceCommandId:'c',readBrief:async()=>structuredClone(brief),events:()=>[call('a'),result('a')]})
  assert.deepEqual(order,['idle','compact']);assert.equal(compacted.shadowedTokens,1200);assert.equal(compacted.decisionManifest.projectCount,1)
  assert.equal(compacted.authorityStable,true);assert.equal(compacted.semanticProbe,'not_run');assert.equal('validation' in compacted,false)
})

test('authority mutation and incomplete events make maintenance fail visibly', async () => {
  let reads=0
  await assert.rejects(compactWithDecisionGuard({agent:{whenIdle:async()=>{}},compaction:{compactNow:async()=>null},signal:new AbortController().signal,readBrief:async()=>({projectIndex:[{id:'p',revision:++reads}],projects:[]}),events:()=>[]}),/DECISIONS_CHANGED/)
  await assert.rejects(compactWithDecisionGuard({agent:{whenIdle:async()=>{}},compaction:{compactNow:async()=>assert.fail()},signal:new AbortController().signal,readBrief:async()=>({}),events:()=>[call('open')]}),/EVENT_INTEGRITY/)
})
