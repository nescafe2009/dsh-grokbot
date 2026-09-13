import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {retrospectiveEvidence,publishRetrospective,readRetrospectives,updateLearning,growthOf,learningPrompt,renderRetrospective} from '../src/retrospective.mjs'
const fixture=async fn=>{const root=await mkdtemp(join(tmpdir(),'retro-'));try{await fn(root)}finally{await rm(root,{recursive:true,force:true})}}
const snapshot=()=>({projectId:'p',projectName:'项目<script>x</script>',fingerprint:'v1',phase:'阶段复盘',roleVersion:'v1',roles:[{botId:'chief',name:'幕僚长',role:'chief',dimensions:['规划']},{botId:'dev',name:'开发',role:'macos',dimensions:['交付']}],evidence:[{id:'step:s',kind:'stage',botId:'dev',accepted:false}],coverage:{}})
const report=()=>({fingerprint:'v1',summary:'观察项目开发并总结',findings:[{kind:'problem',observation:'缺少边界测试',cause:'验收条件没有覆盖',evidence:['step:s']}],ratings:[{botId:'chief',dimensions:[{name:'规划',score:2,reason:'验收覆盖不足',evidence:['step:s']}],suggestion:'补充边界验收'},{botId:'dev',dimensions:[{name:'交付',score:null,reason:'尚未验收',evidence:[]}],suggestion:'补齐测试'}],actions:[{botId:'dev',trigger:'有边界输入',practice:'交付前列边界用例',criterion:'边界用例通过且用户验收',evidence:['step:s']}]})
test('report requires real role evidence, every member and current fingerprint',()=>fixture(async root=>{
 const get=async()=>snapshot()
 await assert.rejects(publishRetrospective(root,{...report(),fingerprint:'old'},get),/变化/)
 const wrong=report();wrong.ratings[0].dimensions[0].evidence=['missing'];await assert.rejects(publishRetrospective(root,wrong,get),/不存在/)
 const no=report();no.ratings.pop();await assert.rejects(publishRetrospective(root,no,get),/所有/)
 const noProof=report();noProof.ratings[1].dimensions[0].score=5;await assert.rejects(publishRetrospective(root,noProof,get),/引用/)
 const foreign=snapshot();foreign.evidence.push({id:'job:other',botId:'other'});const cross=report();cross.ratings[1].dimensions[0]={name:'交付',score:5,reason:'借用别人',evidence:['job:other']};await assert.rejects(publishRetrospective(root,cross,async()=>foreign),/不属于/)
}))
test('duplicate and concurrent review publishes are idempotent, unknown is not zero, report escapes HTML',()=>fixture(async root=>{
 const [a,b]=await Promise.all([publishRetrospective(root,report(),async()=>snapshot()),publishRetrospective(root,report(),async()=>snapshot())])
 assert.equal(a.id,b.id);assert.equal(b.reused,true);assert.equal((await readRetrospectives(root)).reports.length,1)
 assert.equal(a.ratings[0].score,40);assert.equal(a.ratings[1].score,null);assert.equal((await growthOf(root,'dev')).exp,0)
 assert.doesNotMatch(renderRetrospective(a),/<script>/);assert.match(renderRetrospective(a),/&lt;script&gt;/)
 assert.match(await learningPrompt(root,'dev','macos'),/边界用例/);assert.equal(await learningPrompt(root,'dev','qa'),'')
}))
test('learning needs a later project and newer accepted evidence; reward once, retire preserves audit',()=>fixture(async root=>{
 const r=await publishRetrospective(root,report(),async()=>snapshot()),input={reportId:r.id,actionId:r.actions[0].id,outcome:'effective',note:'后续边界用例通过并验收',evidenceIds:['step:s']}
 await assert.rejects(updateLearning(root,input,async()=>snapshot()),/后续项目/)
 const next={...snapshot(),projectId:'p2',fingerprint:'v2'}
 await assert.rejects(updateLearning(root,input,async()=>next),/已验收/)
 next.evidence[0].accepted=true;next.evidence[0].review={at:r.createdAt-1}
 await assert.rejects(updateLearning(root,input,async()=>next),/新验收/)
 next.evidence[0].review.at=r.createdAt+10
 await updateLearning(root,input,async()=>next);assert.equal((await growthOf(root,'dev')).exp,5)
 await assert.rejects(updateLearning(root,input,async()=>next),/重复/)
 const copy=report();copy.fingerprint='v3';copy.actions[0].practice='列举并执行边界用例';const r2=await publishRetrospective(root,copy,async()=>({...snapshot(),fingerprint:'v3'}));next.evidence[0].review.at=r2.createdAt+10
 const result=await updateLearning(root,{...input,reportId:r2.id,actionId:r2.actions[0].id},async()=>next);assert.equal(result.verification.exp,0)
 await updateLearning(root,{...input,outcome:'retired',note:'已不适用'},async()=>next)
 assert.equal((await growthOf(root,'dev')).exp,5);assert.equal((await readRetrospectives(root)).reports[0].actions[0].state,'retired')
}))
test('project snapshot includes archived lifecycle and jobs, redacts nested secrets without fabricating acceptance',()=>fixture(async root=>{
 await mkdir(join(root,'project-lifecycle'));await mkdir(join(root,'inbox','j'),{recursive:true})
 await writeFile(join(root,'project-lifecycle','p.json'),JSON.stringify({version:1,revision:1,epoch:1,status:'archived',reviews:{},history:[{action:'archive',summary:'token=abc123'}]}))
 await writeFile(join(root,'inbox','queue.jsonl'),JSON.stringify({jobId:'j',conversationId:'p',toBot:'dev',text:'实现功能'})+'\n')
 await writeFile(join(root,'inbox','j','checkpoint.json'),JSON.stringify({password:'should-hide'}))
 const snap=await retrospectiveEvidence({stateDir:root,inboxRoot:join(root,'inbox'),room:{id:'p',name:'项目',memberBotIds:['chief','dev']},bots:[{id:'chief',name:'幕僚长'},{id:'dev',name:'开发',title:'macOS 开发'}]})
 assert.equal(snap.status,'archived');assert.equal(snap.phase,'阶段复盘');assert.equal(snap.coverage.totalJobs,1);assert.equal(snap.evidence.find(e=>e.id==='job:j').status,'queued')
 assert.doesNotMatch(JSON.stringify(snap),/should-hide|abc123/);assert.ok(snap.fingerprint)
}))
