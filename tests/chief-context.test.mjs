import test from 'node:test'
import assert from 'node:assert/strict'
import {chiefBrief,managementRoom} from '../src/chief-context.mjs'
const crew={bots:[{id:'chief',name:'幕僚长'},{id:'a',name:'工程师'}],conversations:[{id:'chief',memberBotIds:['chief']},{id:'g',name:'传输应用',memberBotIds:['a','chief']},{id:'g2',name:'其他项目',memberBotIds:['chief','a']},{id:'private',memberBotIds:['a']}]}
test('chief DM project targeting is explicit and group/specialist boundaries remain enforced',()=>{
 assert.equal(managementRoom(crew,'chief','chief','g').id,'g')
 assert.equal(managementRoom(crew,'chief',null,'g').id,'g')
 assert.throws(()=>managementRoom(crew,'a',null,'g'),/只有幕僚长/)
 assert.throws(()=>managementRoom(crew,'chief','g','g2'),/私聊/)
 assert.throws(()=>managementRoom(crew,'chief','chief','private'),/项目群/)
 assert.throws(()=>managementRoom(crew,'chief','deleted'),/不存在/)
})
test('brief recovers scope and actual status despite empty long-term memory; read failure remains explicit',async()=>{
 const called=[]
 const b=await chiefBrief({crew,projectId:'g',selection:{model:'current'},board:async id=>{called.push(id);return {rows:[{id:'architecture',status:'failed',reason:'quota'}]}},history:async()=>[{role:'user',text:'完成设计后停下来，不要写代码',ts:1}],dm:async()=>[{role:'user',text:'继续',ts:2}]})
 assert.deepEqual(called,['g']);assert.equal(b.projects[0].tasks[0].status,'failed');assert.match(b.projects[0].userInstructions[0].text,/不要写代码/);assert.equal(b.projects[0].name,'传输应用')
 const fail=await chiefBrief({crew,projectId:'g',board:async()=>{throw Error('disk unavailable')},history:async()=>[],dm:async()=>[]});assert.match(fail.projects[0].error,/读取失败/)
 await assert.rejects(chiefBrief({crew,projectId:'private'}),/管理范围/)
})

test('brief retains authorship and marks truncated member reports and past chief claims as unverified',async()=>{
 const b=await chiefBrief({crew,projectId:'g',board:async()=>({rows:[],members:[{id:'a',name:'工程师',status:'idle'}]}),history:async()=>[{role:'bot',botId:'a',text:'文件已经写好'.repeat(500),ts:1},{role:'user',text:'只设计，等我确认',ts:2},{role:'system',text:'保存了成员回复',ts:3}],dm:async()=>[{role:'bot',text:'已完成',ts:4},{role:'user',text:'继续',ts:5}]})
 assert.equal(b.projects[0].liveMembers[0].status,'idle')
 const reports=b.projects[0].recentUpdates
 assert.equal(reports[0].source,'member_report_unverified');assert.equal(reports[0].speaker,'工程师');assert.equal(reports[0].verified,false);assert.equal(reports[0].truncated,true)
 assert.equal(reports[1].source,'system_event');assert.equal(b.projects[0].userInstructions[0].source,'user_message')
 assert.equal(b.recentChiefConversation[0].source,'chief_previous_reply_unverified');assert.equal(b.recentChiefConversation[1].source,'user_message')
})

test('archived projects leave the active briefing but retain an explicit restore index',async()=>{
 const result=await chiefBrief({crew:{bots:[{id:'chief'}],conversations:[{id:'g',name:'旧项目',memberBotIds:['chief','dev']}]},board:async()=>({lifecycle:{status:'archived',revision:1},rows:[{title:'PRIVATE_OLD_TASK'}],members:[]}),history:async()=>[],dm:async()=>[],selection:null})
 assert.equal(result.projects.length,0)
 assert.equal(result.archivedProjects[0].id,'g')
 assert.ok(!JSON.stringify(result).includes('PRIVATE_OLD_TASK'))
})
