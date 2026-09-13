import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseCrew, createBot, updateBot, duplicateBot, serializeCrew} from '../src/crew.mjs'
import {ROLE_PROFILES, resolveRole, roleInstructions} from '../src/roles.mjs'
import {rolePrompt, refreshIdentity} from '../src/role-prompt.mjs'
import {BOT_TEMPLATES} from '../src/templates.mjs'
import {LEGACY_PERSONAS} from '../src/legacy-personas.mjs'
const crew = () => parseCrew(JSON.stringify({bots:[{id:'chief',name:'幕僚长'}]}))

test('existing named specialists get distinct professional duties without changing stored custom data',()=>{
 const c=crew()
 for(const [name,title,expected] of [['林一舟','架构师 / 技术负责人','architect'],['陈沐','鸿蒙开发工程师（HarmonyOS Next）','harmony'],['苏晚','macOS 开发工程师（Swift / SwiftUI）','macos'],['顾行洲','Windows 开发工程师（.NET / WPF）','windows'],['白泽','测试工程师（QA / 跨端）','qa']]){
  const b=createBot(c,{name,title});assert.equal(resolveRole(b),expected)
  const prompt=rolePrompt(b);assert.ok(prompt.includes(name));assert.ok(prompt.includes(title));assert.ok(prompt.includes(ROLE_PROFILES[expected].mission));assert.equal(b.persona,'')
 }
 const reloaded=parseCrew(serializeCrew(c));assert.equal(resolveRole(reloaded.bots[1]),'architect')
})
test('all presets have deliverables and boundaries; names remain profile data after rename and duplicate',()=>{
 const c=crew()
 for(const template of BOT_TEMPLATES.filter(t=>!t.blank)) {
  assert.match(template.persona,/职责目标：[\s\S]+工作方法：[\s\S]+交付要求：[\s\S]+职责边界：/)
  const b=createBot(c,{name:'自定义名字',title:template.title,roleTemplate:template.id,persona:template.persona})
  const text=rolePrompt(b);assert.match(text,/姓名：自定义名字/);assert.ok(!text.includes(template.name))
 }
 const b=createBot(c,{name:'旧名字',title:'架构师',roleTemplate:'architect'})
 updateBot(c,b.id,{name:'新名字'});assert.match(rolePrompt(b),/姓名：新名字/)
 assert.equal(resolveRole(duplicateBot(c,b.id)),'architect')
})
test('custom rules persist, exact legacy presets upgrade, unknown roles stay unknown',()=>{
 const c=crew(),custom='只维护现有数据库接口，不修改客户端。'
 const b=createBot(c,{name:'接口顾问',title:'架构师',persona:custom})
 assert.ok(rolePrompt(b).includes(custom));assert.equal(b.persona,custom)
 const legacy=LEGACY_PERSONAS.find(t=>t.id==='coder')
 b.persona=legacy.persona;assert.ok(!rolePrompt(b).includes('顾远航'))
 b.persona=legacy.persona+'\n自定义规则';assert.ok(rolePrompt(b).includes('自定义规则'))
 const unknown=createBot(c,{name:'园丁',title:'园艺顾问'})
 assert.equal(resolveRole(unknown),'');assert.match(rolePrompt(unknown),/园艺顾问/);assert.doesNotMatch(rolePrompt(unknown),/编码与调试/)
 assert.throws(()=>createBot(c,{name:'错配置',roleTemplate:'nonexistent'}),/未知角色模板/)
})
test('changing inferred title changes duties; explicit template survives reload; chief permissions stay unique',()=>{
 const c=crew(),b=createBot(c,{name:'成员',title:'架构师'})
 updateBot(c,b.id,{title:'测试工程师'});assert.equal(resolveRole(b),'qa')
 updateBot(c,b.id,{roleTemplate:'architect',title:'技术顾问'});assert.equal(resolveRole(parseCrew(serializeCrew(c)).bots[1]),'architect')
 const copy=duplicateBot(c,'chief');assert.notEqual(resolveRole(copy),'chief');assert.match(rolePrompt(copy),/不声称拥有幕僚长专属权限/)
})
test('cached assembled identities are replaced once, keeping team and memory sections intact',()=>{
 const other={name:'grokbot:memory',text:'用户偏好'}
 const first=refreshIdentity([{name:'grokbot:identity',text:'old'},{name:'grokbot:identity',text:'duplicate'},other],rolePrompt({name:'林一舟',title:'架构师'}))
 const second=refreshIdentity(first,rolePrompt({name:'林一舟',title:'测试工程师'}))
 assert.equal(second.filter(s=>s.name==='grokbot:identity').length,1)
 assert.match(second[0].text,/逐项验收证据/);assert.equal(second[1],other)
})
test('QA follows evidence and preserves blocked/untested outcomes rather than forced failure',()=>{
 const prompt=roleInstructions('qa')
 assert.match(prompt,/通过、失败、阻塞、未测/);assert.match(prompt,/不预设首轮必失败/)
 assert.match(prompt,/技术测试结论不能替代用户最终验收/)
})
