import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {approvalRuleCandidate,ApprovalRules} from '../src/approval-rules.mjs'
import {characterPhase,readCharacterPhase} from '../src/character-phase.mjs'
test('saved rules bind exact command, bot, conversation, workspace and permissions; expiry and revoke survive restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gk-rules-'));try{
 const other=join(root,'other');await mkdir(other)
 const base={botId:'b',conversationId:'g',toolName:'bash',workspace:root,reason:'escalate sandbox to workspace-write: build',args:{command:'npm run build',sandbox_permissions:'workspace-write',justification:'build'}}
 const candidate=await approvalRuleCandidate(base);assert.ok(candidate)
 const book=new ApprovalRules(root);assert.equal(await book.match(candidate),null)
 await book.grant(candidate,{approvalId:'a',now:1000});assert.ok(await new ApprovalRules(root).match(candidate,1001))
 assert.equal((await approvalRuleCandidate({...base,args:{...base.args,justification:'another explanation'}})).fingerprint,candidate.fingerprint)
 for(const change of [{botId:'c'},{conversationId:'other'},{workspace:other},{args:{...base.args,command:'npm run build && echo more'}},{args:{...base.args,timeout_ms:2000}},{reason:'escalate sandbox to danger-full-access: build',args:{...base.args,sandbox_permissions:'danger-full-access'}}])assert.equal(await book.match(await approvalRuleCandidate({...base,...change}),1001),null)
 assert.equal(await book.match(candidate,1000+86400000),null)
 const rule=(await book.list(1001))[0];await book.revoke(rule.id);assert.equal(await new ApprovalRules(root).match(candidate,1001),null)
 for(const command of ['sudo npm run build','rm -rf target','API_KEY=secret npm run build'])assert.equal(await approvalRuleCandidate({...base,args:{...base.args,command}}),null)
 assert.equal(await approvalRuleCandidate({...base,reason:'no escalation'}),null)
 let checks=0;await assert.rejects(book.grant(candidate,{approvalId:'cancel',stillPending:()=>++checks<3,now:1000}),/取消/);assert.equal(await book.match(candidate,1001),null)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('motion tool phase never inherits an old run or completed native call',()=>{
 const call={seq:1,type:'tool/call',data:{callId:'c'}}
 assert.equal(characterPhase([call],2),'active')
 assert.equal(characterPhase([call],1),'working')
 const result={seq:2,type:'tool/result',data:{message:{source:{callId:'c'},content:[{type:'tool-result',toolCallId:'c'}]}}}
 assert.equal(characterPhase([call,result],1),'active')
 assert.equal(characterPhase([call,{...result,data:{message:{source:{callId:'other'}}}}],1),'working')
})

test('character phase reads fresh native immutable snapshots',()=>{
 let events=Object.freeze([]);const source={firstSeq:0,session:{get events(){return events}}}
 assert.equal(readCharacterPhase(source),'active')
 events=Object.freeze([{seq:0,type:'tool/call',data:{callId:'c'}}]);assert.equal(readCharacterPhase(source),'working')
 events=Object.freeze([...events,{seq:1,type:'tool/result',data:{callId:'c'}}]);assert.equal(readCharacterPhase(source),'active')
})
