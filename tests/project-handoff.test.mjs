import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {bindProjectOrigin,prepareHandoff,flushHandoff,readHandoff,reviewRequest} from '../src/project-handoff.mjs'
const row={id:'design',title:'设计',botId:'dev',dependsOn:[],jobIds:['j1'],source:'plan',status:'awaiting_acceptance',checkpoint:{files:['design.md']}}
test('handoff persists source, retries failed delivery and deduplicates completed requests across reload',async()=>{
 const root=await mkdtemp(join(tmpdir(),'handoff-'))
 try{
  await bindProjectOrigin(root,'g','chief-dm')
  await bindProjectOrigin(root,'g','wrong-room')
  await prepareHandoff(root,'g',{name:'项目',rows:[row],epoch:0,summary:'已核实设计',originConversationId:'fallback'})
  let state=await flushHandoff(root,'g',async()=>{throw Error('disk busy')})
  assert.equal(state.originConversationId,'chief-dm');assert.equal(state.requests[0].status,'pending')
  await assert.rejects(reviewRequest(root,'g',state.requests[0].requestId),/已送达/)
  const p=join(root,'project-handoffs/g.json');state.requests[0].nextAttemptAt=0;await writeFile(p,JSON.stringify(state))
  const sent=[];await flushHandoff(root,'g',async(origin,entry)=>sent.push({origin,entry}))
  await prepareHandoff(root,'g',{name:'项目',rows:[row],epoch:0,summary:'重复协调',originConversationId:'fallback'})
  await flushHandoff(root,'g',async(origin,entry)=>sent.push({origin,entry}))
  assert.equal(sent.length,1);assert.equal(sent[0].origin,'chief-dm');assert.match(sent[0].entry.text,/design.md/)
  assert.equal((await readHandoff(root,'g')).requests[0].status,'delivered')
  assert.equal((await reviewRequest(root,'g',sent[0].entry.requestId)).stepId,'design')
 }finally{await rm(root,{recursive:true,force:true})}
})
test('changed work and execution epochs invalidate old review requests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'handoff-'))
 try{
  const prepare=(rows,epoch=0)=>prepareHandoff(root,'g',{name:'项目',rows,epoch,summary:'检查',originConversationId:'chief'})
  let s=await prepare([row]);const old=s.requests[0].requestId
  await flushHandoff(root,'g',async()=>{})
  s=await prepare([{...row,jobIds:['j1','j2']}]);assert.equal(s.requests.length,2)
  await assert.rejects(reviewRequest(root,'g',old),/有效/)
  s=await prepare([{...row,jobIds:['j1','j2']}],1);assert.equal(s.requests.length,3)
  assert.equal(s.requests.filter(r=>!r.superseded).length,1)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('routine chief review does not request user action and stale outbox delivery is suppressed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'handoff-'))
 try{
  let state=await prepareHandoff(root,'g',{name:'项目',rows:[{...row,reviewMode:'chief'}],epoch:0,summary:'工程测试',originConversationId:'chief'})
  assert.equal(state.requests.length,0)
  await prepareHandoff(root,'g',{name:'项目',rows:[row],epoch:0,summary:'审阅',originConversationId:'chief'})
  let sent=0
  state=await flushHandoff(root,'g',async()=>{sent++},async()=>false)
  assert.equal(sent,0);assert.equal(state.requests[0].superseded,true)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('multiple stages retain independent review authorization without duplicating chief summary',async()=>{
 const root=await mkdtemp(join(tmpdir(),'handoff-'))
 try{
  const state=await prepareHandoff(root,'g',{name:'项目',rows:[row,{...row,id:'ui',title:'交互',jobIds:['j2']}],epoch:0,summary:'重复长汇报 [试玩](https://example.test/game)',originConversationId:'chief'})
  assert.equal(state.requests.length,2)
  for(const request of state.requests){assert.doesNotMatch(request.text,/重复长汇报|example.test/);assert.match(request.text,/待审阅/)}
  await flushHandoff(root,'g',async()=>{})
  assert.equal((await reviewRequest(root,'g',state.requests[0].requestId)).stepId,'design')
  assert.equal((await reviewRequest(root,'g',state.requests[1].requestId)).stepId,'ui')
 }finally{await rm(root,{recursive:true,force:true})}
})
