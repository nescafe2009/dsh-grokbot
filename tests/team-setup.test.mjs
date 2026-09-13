import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseCrew} from '../src/crew.mjs'
import {prepareTeam,exactMember,setupJobId} from '../src/team-setup.mjs'
const crew=()=>parseCrew(JSON.stringify({bots:[{id:'chief',name:'幕僚长'},{id:'lin',name:'林一舟',title:'架构师'},{id:'su',name:'苏晚',title:'工程师'},{id:'qa',name:'白泽',title:'测试工程师'}]}))
test('setup reuses existing people; subsequent complete group expands the same room',()=>{
 const c=crew(),first=prepareTeam(c,{name:'项目',members:[{name:'林一舟',role:'架构师'}],createMembers:true})
 assert.equal(first.draft.bots.length,4);assert.equal(first.members[0].existing,true)
 const second=prepareTeam(first.draft,{name:' 项目 ',members:[{name:'林一舟'},{name:'苏晚'},{name:'白泽'}]},[first.room.id])
 assert.equal(second.room.id,first.room.id);assert.equal(second.draft.conversations.length,1);assert.equal(second.room.memberBotIds.length,4)
 assert.equal(first.room.memberBotIds.length,2,'staging does not mutate source')
})
test('invalid later member or duplicate list does not partially mutate crew',()=>{
 const c=crew(),before=JSON.stringify(c)
 assert.throws(()=>prepareTeam(c,{name:'项目',members:[{name:'新人',role:'工程师'},{name:'坏配置',role:'工程师',templateId:'invalid'}],createMembers:true}),/未知角色/)
 assert.equal(JSON.stringify(c),before)
 assert.throws(()=>prepareTeam(c,{name:'项目',members:[{name:'林一舟'},{name:'林一舟'}]}),/重复/)
 assert.equal(JSON.stringify(c),before)
})
test('exact member matching rejects ambiguity, partial names and missing IDs',()=>{
 const c=crew();assert.throws(()=>exactMember(c,{name:'一舟'}),/不存在/)
 c.bots.push({...c.bots[1],id:'copy'})
 assert.throws(()=>exactMember(c,{name:'林一舟'}),/不唯一/)
 assert.equal(exactMember(c,{member_id:'lin',name:'林一舟'}).bot.id,'lin')
 assert.throws(()=>exactMember(c,{member_id:'ghost',name:'林一舟'}),/不存在/)
})
test('terminal room is not silently restored; ambiguous active projects fail closed',()=>{
 const c=crew(),first=prepareTeam(c,{name:'项目',members:[{name:'林一舟'}]})
 const second=prepareTeam(first.draft,{name:'项目',members:[{name:'林一舟'}]},[])
 assert.notEqual(second.room.id,first.room.id)
 assert.throws(()=>prepareTeam(second.draft,{name:'项目',members:[{name:'林一舟'}]},[first.room.id,second.room.id]),/多个同名/)
})
test('setup retry key is stable across reloads and isolated by project and member',()=>{
 const r={task:'设计',deliverable:'设计稿',acceptance:'包含接口'}
 const id=setupJobId('a','lin',r);assert.equal(setupJobId('a','lin',JSON.parse(JSON.stringify(r))),id)
 assert.notEqual(setupJobId('b','lin',r),id);assert.notEqual(setupJobId('a','su',r),id)
})
