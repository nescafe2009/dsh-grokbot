import test from 'node:test'
import assert from 'node:assert/strict'
import {compactUserDirectiveView,contextHistoryPage,relevantUserHistory,userDirectiveView} from '../src/context-view.mjs'

const messages=[
 {role:'user',ts:1,text:'你好'},
 {role:'user',ts:2,text:'以后禁止自动发布',requestId:'a'},
 {role:'user',ts:3,text:'临时问候'},
 {role:'bot',ts:4,text:'不进入用户账本'},
 {role:'user',ts:5,text:'以后禁止自动发布',requestId:'a'},
 {role:'user',ts:6,text:'现在进展如何'},
]
test('global view keeps durable and recent wording, collapses exact retries and references full source',()=>{
 const view=userDirectiveView(messages,{scope:'chief',recentLimit:1})
 assert.deepEqual(view.items.map(item=>item.text),['你好','以后禁止自动发布','临时问候','现在进展如何'])
 assert.equal(view.items[1].occurrences,2);assert.equal(view.duplicatesCollapsed,1);assert.equal(view.omittedNonDirective,0)
 assert.equal(view.sourceRef.tool,'team_context_history_read')
})
test('project view preserves all distinct user messages and source pages reconstruct exactly',()=>{
 const view=userDirectiveView(messages,{scope:'p',preserveAll:true})
 assert.equal(view.items.length,4)
 let text='',offset=0
 for(;;){const page=contextHistoryPage(messages,{content_hash:view.sourceRef.content_hash,message_count:view.sourceRef.message_count,offset,limit:17});text+=page.content;if(page.complete)break;offset=page.nextOffset}
 assert.equal(JSON.parse(text).length,5)
 assert.throws(()=>contextHistoryPage([...messages,{role:'user',text:'new'}],{content_hash:view.sourceRef.content_hash}),/HISTORY_CHANGED/)
})

test('only identical request replays collapse; collisions fail and repeated text keeps chronology',()=>{
 const chronology=userDirectiveView([
  {role:'user',ts:1,text:'通过'},
  {role:'user',ts:2,text:'修改第二阶段'},
  {role:'user',ts:3,text:'通过'},
 ],{scope:'p'})
 assert.deepEqual(chronology.items.map(item=>item.text),['通过','修改第二阶段','通过'])
 assert.throws(()=>userDirectiveView([
  {role:'user',ts:1,requestId:'same',text:'禁止发布'},
  {role:'user',ts:2,requestId:'same',text:'允许发布'},
 ],{scope:'p'}),/REQUEST_ID_COLLISION/)
})

test('old short decisions stay visible and history pages use an immutable prefix',()=>{
 const original=[{role:'bot',ts:0,text:'请选择 A/B/C/D'},{role:'user',ts:1,text:'D吧'},...Array.from({length:11},(_,i)=>({role:'user',ts:i+2,text:`追问${i}`}))]
 const view=userDirectiveView(original,{scope:'chief',recentLimit:2})
 assert.equal(view.items[0].text,'D吧')
 assert.match(view.items[0].replyContext.text,/请选择/)
 const appended=[...original,{role:'user',ts:99,text:'新消息'}]
 const page=contextHistoryPage(appended,{content_hash:view.sourceRef.content_hash,message_count:view.sourceRef.message_count,offset:0,limit:12000})
 assert.equal(JSON.parse(page.content).length,view.sourceRef.message_count)
})

test('implicit reply context only binds the directly adjacent bot question',()=>{
 const source=userDirectiveView([
  {role:'bot',ts:1,text:'是否允许生产发布？'},
  {role:'user',ts:2,text:'先检查测试报告'},
  {role:'system',ts:3,text:'状态刷新'},
  {role:'user',ts:4,text:'同意'},
 ],{scope:'p'})
 assert.match(source.items[0].replyContext.text,/生产发布/)
 assert.equal(source.items[1].replyContext,undefined)
})

test('query-aware retrieval surfaces a distant decision without treating it as authorization',()=>{
 const history=[{role:'user',ts:1,text:'同意，流量时每天零点重置'},...Array.from({length:80},(_,i)=>({role:'user',ts:i+2,text:`其他讨论 ${i}`}))]
 const found=relevantUserHistory(history,'我之前同意流量每天什么时间重置？')
 assert.equal(found[0].text,'同意，流量时每天零点重置')
 assert.ok(found[0].score>0)
})

test('cross-scope directive catalogue stays bounded and keeps exact source identity',()=>{
 const long='早期会议纪要：'+ '一般背景材料'.repeat(200)
 const history=[{role:'user',ts:1,text:long,requestId:'global-1'},...Array.from({length:8},(_,i)=>({role:'user',ts:i+2,text:`讨论 ${i}`}))]
 const view=compactUserDirectiveView(history,{scope:'chief',recentLimit:2,previewLimit:80})
 assert.equal(view.items.length,9)
 assert.equal(view.items[0].requestId,'global-1')
 assert.equal(view.items[0].contentLength,long.length)
 assert.equal(view.items[0].text.length,80)
 assert.equal(view.sourceRef.message_count,9)
 assert.ok(JSON.stringify(view).length<JSON.stringify(userDirectiveView(history,{scope:'chief'})).length)
 const large=compactUserDirectiveView(Array.from({length:10000},(_,i)=>({role:'user',ts:i,text:`普通消息 ${i}`})),{scope:'chief'})
 assert.equal(large.items.length,48)
 assert.equal(large.omittedCatalogMessages,9952)
 assert.ok(JSON.stringify(large).length<18000)
})
