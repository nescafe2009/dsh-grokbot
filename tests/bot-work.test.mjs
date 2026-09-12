import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {botWork,workActivity,workText} from '../src/bot-work.mjs'
import {workUsage} from '../src/work-usage.mjs'

test('execution view distinguishes cancelled, stale running and orphaned claims without resurrecting jobs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bot-work-'))
 try {
  const jobs=[{jobId:'old',toBot:'worker',conversationId:'room',text:'修复按钮',createdAt:1,fromBotId:'chief'},{jobId:'live',toBot:'worker',text:'测试点击',createdAt:2},{jobId:'orphan',toBot:'worker',text:'旧执行',createdAt:3},{jobId:'foreign',toBot:'other',text:'不可混入',createdAt:4}]
  await writeFile(join(root,'queue.jsonl'),jobs.map(j=>JSON.stringify(j)).join('\n'))
  for(const j of jobs){await mkdir(join(root,j.jobId));await writeFile(join(root,j.jobId,'status.json'),JSON.stringify({status:j.jobId==='old'?'cancelled':'claimed',startedAt:10,reason:j.jobId==='old'?'范围变化':''}))}
  await writeFile(join(root,'live','progress.json'),JSON.stringify({updatedAt:20,lastActivityAt:15,activeTools:['bash']}))
  await writeFile(join(root,'old','reply.md'),'之前的交付')
  await writeFile(join(root,'live','usage.json'),JSON.stringify({...workUsage([{seq:1,type:'assistant/message',data:{turn:1,step:1,usage:{inputTokens:12}}}]),jobId:'live',botId:'worker',nativeSessionId:'228b4b58-4040-4ee2-904d-a37646bcb857',raw:'private-provider-payload'}))
  await writeFile(join(root,'old','usage.json'),JSON.stringify({schema:1,jobId:'foreign',botId:'other',observedSteps:1,unidentifiedMessages:0}))
  const result=await botWork({stateDir:root,inboxRoot:root,botId:'worker',runningIds:['live'],bots:[{id:'chief',name:'幕僚长'}],conversations:[{id:'room',name:'项目'}],now:100000})
  assert.equal(result.jobs.length,3);assert.equal(result.jobs[0].id,'live');assert.equal(result.jobs[0].status,'running');assert.equal(result.jobs[0].stale,true)
  assert.equal(result.jobs[0].usage.fields.inputTokens.sumReported,12);assert.equal(result.jobs.find(j=>j.id==='old').usage,null)
  assert.doesNotMatch(JSON.stringify(result),/private-provider-payload/)
  assert.equal(result.jobs.find(j=>j.id==='old').status,'cancelled');assert.equal(result.jobs.find(j=>j.id==='old').from,'幕僚长');assert.equal(result.jobs.find(j=>j.id==='orphan').status,'interrupted')
  await assert.rejects(botWork({stateDir:root,inboxRoot:root,botId:'../oops'}))
 } finally {await rm(root,{recursive:true,force:true})}
})
test('bounded tool records retain real commands and results but exclude reasoning and redact common secrets',()=>{
 const events=[{seq:1,type:'assistant/reasoning',data:{text:'private thought'}},{seq:2,type:'tool/call',data:{callId:'a',name:'bash',arguments:{command:'npm test',token:'should-not-serialize'}}},{seq:3,type:'tool/result',data:{message:{source:{callId:'a'},content:[{type:'tool-result',content:'passed token=secret-value',isError:false}]}}}]
 const rows=workActivity(events,0,44);assert.equal(rows.length,2);assert.equal(rows[0].text,'npm test');assert.equal(rows[1].callId,'a');assert.match(rows[1].text,/已隐藏/);assert.equal(rows[1].at,44);assert.doesNotMatch(JSON.stringify(rows),/private thought|should-not-serialize|secret-value/)
 assert.equal(workActivity(Array.from({length:200},(_,seq)=>({seq,type:'tool/call',data:{name:'bash'}}))).length,80)
 assert.doesNotMatch(workText('Authorization: Bearer sk-abcdefghijklmnop'),/sk-abcdefghijklmnop/)
})
test('execution records include visible progress and full edit inputs, redact JSON secrets, preserve event time',()=>{
 const rows=workActivity([{seq:1,time:123,type:'assistant/message',data:{message:{content:[{type:'reasoning',text:'hidden reasoning'},{type:'text',text:'正在运行回归测试'}]}}},{seq:2,time:124,type:'tool/call',data:{name:'edit',arguments:{path:'app.ts',old_string:'before',new_string:'after',token:'private-value'}}}])
 assert.equal(rows[0].kind,'progress');assert.equal(rows[0].at,123);assert.match(rows[1].text,/before/);assert.match(rows[1].text,/after/)
 assert.doesNotMatch(JSON.stringify(rows),/hidden reasoning|private-value/)
})
