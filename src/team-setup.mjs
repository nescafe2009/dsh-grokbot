import {createHash} from 'node:crypto'
import {createBot, createConversation, addConversationMember} from './crew.mjs'
export const teamName = value => String(value || '').normalize('NFKC').trim()
export function exactMember(crew, {member_id, name}, {create=false, role='', templateId='', persona=''}={}) {
 if(member_id){const bot=crew.bots.find(b=>b.id===member_id&&!b.hidden);if(!bot)throw Error('成员 ID 不存在或已隐藏：'+member_id);return {bot,existing:true}}
 const wanted=teamName(name);if(!wanted)throw Error('成员姓名不能为空')
 const matches=crew.bots.filter(b=>!b.hidden&&teamName(b.name)===wanted)
 if(matches.length>1)throw Error('成员姓名不唯一，请指定 member_id：'+wanted)
 if(matches.length===1)return {bot:matches[0],existing:true}
 if(!create)throw Error('成员不存在：'+wanted)
 if(!teamName(role))throw Error('新成员必须提供职位：'+wanted)
 return {bot:createBot(crew,{name:wanted,title:role,roleTemplate:templateId,persona}),existing:false}
}
// Stage all changes in a draft. Invalid later members never leave half-created teams.
export function prepareTeam(crew, {name,members,actorId='chief',createMembers=false}, existingRoomIds=[]) {
 const title=teamName(name);if(!title)throw Error('项目群名称不能为空')
 if(!Array.isArray(members)||!members.length||members.length>6)throw Error('团队成员必须为1至6项')
 const draft=structuredClone(crew)
 const resolved=members.map(m=>exactMember(draft,m,{create:createMembers,role:m.role,templateId:m.templateId,persona:m.persona}))
 const requested=resolved.map(m=>m.bot.id)
 if(new Set(requested).size!==requested.length)throw Error('成员列表重复，请每人只列一次')
 const ids=[...new Set([...requested,actorId])]
 if(ids.length<2||ids.length>6)throw Error('项目群须包含2至6名成员（含幕僚长）')
 const matches=draft.conversations?.filter(c=>existingRoomIds.includes(c.id)&&teamName(c.name)===title)||[]
 if(matches.length>1)throw Error('已有多个同名未归档群，请先核对项目 ID，不再创建第三个')
 let room=matches[0]
 if(room){
  if(!room.memberBotIds.includes(actorId))throw Error('同名项目不属于当前协调者，请使用不同名称')
  if(new Set([...room.memberBotIds,...ids]).size>6)throw Error('补齐成员后超过6人上限')
  for(const id of ids)if(!room.memberBotIds.includes(id))addConversationMember(draft,room.id,id)
 }else room=createConversation(draft,{name:title,memberBotIds:ids})
 return {draft,room,members:resolved,existing:matches.length===1}
}
export function setupJobId(roomId,memberId,request) {
 return 'job_setup_'+createHash('sha256').update(JSON.stringify([roomId,memberId,...['task','deliverable','acceptance'].map(k=>String(request[k]||'').trim())])).digest('hex').slice(0,24)
}
