import { ROLE_PROFILES, roleInstructions } from './roles.mjs'

export const BOT_TEMPLATES = [
  {id:'blank', name:'空白 Bot', avatar:'🤖', title:'对话式初始化', persona:'', blank:true},
  ...Object.values(ROLE_PROFILES).map(role => ({
    id: role.id, name: role.name, avatar: role.avatar, title: role.title,
    persona: roleInstructions(role.id),
    greeting: `你好，我是**${role.name}**，${role.title}。\n\n${role.mission}\n\n可以直接告诉我你要处理的问题。`,
  })),
]
export function templateById(id) { return BOT_TEMPLATES.find(template => template.id === id) || null }
