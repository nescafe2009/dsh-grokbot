import test from 'node:test'
import assert from 'node:assert/strict'
import {workingBoardContext,contextEvidencePage,workingContextSize} from '../src/context-policy.mjs'
import {chiefBrief} from '../src/chief-context.mjs'
const fixture=()=>({lifecycle:{conversationId:'p',revision:7,epoch:2,status:'active',externalReviewer:{kind:'codex',threadId:'t'},blocker:'需要保留的阻塞',stepGenerations:{dev:5},reviews:{dev:{actor:'chief',fingerprint:'old',dependencyFingerprints:{a:'fp'},evidence:'OLD-REPORT'.repeat(3000)}},reworks:{dev:{generation:5,phase:'repair',criteria:'禁止操作真机。'.repeat(1000),reason:'成功分支漏验 PID',evidence:'DETAIL'.repeat(1000),repairJobId:'repair',testerBotId:'qa'}},history:[{snapshot:'OLD'.repeat(50000)}]},rows:[{id:'dev',source:'plan',status:'awaiting_retest',fingerprint:'new',accepted:false,reviewMode:'chief',generation:5,latestJobId:'repair',reason:'等待 QA',checkpoint:{completed:'REPORT'.repeat(1000),blockers:'还未验证中文输入',remaining:'必须复测'}},{id:'delivery',source:'plan',status:'blocked',reviewMode:'codex',dependsOn:['dev']},{id:'repair',source:'job',status:'done'},{id:'running',source:'job',status:'running'},{id:'failed',source:'job',status:'failed',reason:'尚未解决'},{id:'old',source:'job',status:'done'}],executionHistory:[{jobId:'old',epoch:2}]})
test('working projection preserves decisions and excludes only ended history and evidence bodies',()=>{
 const board=fixture(),before=JSON.stringify(board),b=workingBoardContext(board,'p')
 assert.equal(JSON.stringify(board),before)
 assert.equal(b.lifecycle.reworks.dev.criteria,board.lifecycle.reworks.dev.criteria)
 assert.equal(b.lifecycle.reworks.dev.reason,'成功分支漏验 PID')
 assert.equal(b.lifecycle.blocker,'需要保留的阻塞')
 assert.deepEqual(b.lifecycle.externalReviewer,board.lifecycle.externalReviewer)
 assert.deepEqual(b.lifecycle.stepGenerations,{dev:5})
 assert.deepEqual(b.lifecycle.reviews.dev.dependencyFingerprints,{a:'fp'})
 assert.equal(b.rows[0].accepted,false);assert.equal(b.rows[0].fingerprint,'new')
 assert.equal(b.rows[0].checkpoint.blockers,'还未验证中文输入')
 assert.deepEqual(b.rows.map(r=>r.id),['dev','delivery','repair','running','failed'])
 assert.equal(b.historyOmitted.taskRows,1)
 assert.doesNotMatch(JSON.stringify(b),/OLD-REPORT|REPORTREPORT/)
 assert.ok(JSON.stringify(b).length<before.length/5)
})
test('evidence pages reconstruct exactly and reject stale revision, changed content, missing data and invalid pages',()=>{
 const board=fixture(),brief=workingBoardContext(board,'p'),params=brief.lifecycle.reviews.dev.evidenceRef
 let content='',offset=0
 for(;;){const page=contextEvidencePage(board,{...params,offset,limit:107});content+=page.content;if(page.complete)break;offset=page.nextOffset}
 assert.deepEqual(JSON.parse(content),board.lifecycle.reviews.dev)
 assert.throws(()=>contextEvidencePage({...board,lifecycle:{...board.lifecycle,revision:8}},params),/REVISION_CHANGED/)
 board.lifecycle.reviews.dev.evidence+='changed'
 assert.throws(()=>contextEvidencePage(board,params),/CONTENT_CHANGED/)
 assert.throws(()=>contextEvidencePage(board,{...params,key:'missing'}),/EVIDENCE_MISSING/)
 assert.throws(()=>contextEvidencePage(board,{...brief.rows[0].evidenceRef,offset:-1}),/分页参数/)
 assert.throws(()=>contextEvidencePage(board,{...params,key:'__proto__'}),/EVIDENCE_MISSING/)
})
test('all project and global user constraints survive; working context excludes model claims and reports',async()=>{
 const messages=[{role:'user',ts:1,text:'只设计不得编码。'.repeat(1000)},...Array.from({length:100},(_,i)=>({role:'bot',text:'成员长报告'.repeat(100),ts:i+2})),{role:'user',ts:103,text:'第二阶段必须等我确认'}]
 const args={crew:{bots:[{id:'chief'}],conversations:[{id:'p',name:'项目',memberBotIds:['chief','dev']}]},projectId:'p',detail:'working',board:async()=>fixture(),history:async()=>messages,dm:async()=>[{role:'bot',text:'我声称一切通过'},{role:'user',text:'不得让 Bot 修改宿主代码'}]}
 const b=await chiefBrief(args)
 assert.equal(b.projects[0].userInstructions[0].text,messages[0].text)
 assert.equal(b.projects[0].userInstructions[0].truncated,false)
 assert.equal(b.projects[0].userInstructions[1].text,'第二阶段必须等我确认')
 assert.deepEqual(b.projects[0].recentUpdates,[])
 assert.equal(b.recentChiefConversation.length,1)
 assert.equal(b.recentChiefConversation[0].text,'不得让 Bot 修改宿主代码')
 assert.match(b.recentChiefConversation[0].scope,/不是当前项目的新授权/)
 assert.ok(b.projects[0].evidenceIndex)
 const failed=await chiefBrief({...args,history:async()=>{throw Error('读取失败')}})
 assert.match(failed.projects[0].error,/读取失败/)
})
test('budget reports excess without dropping long critical content or inventing token counts',()=>{
 const b={constraint:'不许越权'.repeat(12000)},before=JSON.stringify(b)
 const budget=workingContextSize(b)
 assert.equal(budget.overTarget,true);assert.equal(budget.tokenEstimate,null)
 assert.equal(JSON.stringify(b),before)
})
