import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {BotAccess,decodeToolArguments} from '../src/bot-access.mjs'
const agent=id=>({session:{id,events:[],append(type,data){this.events.push({type,data})}}})
const mode=a=>a.session.events.filter(e=>e.type==='sandbox/mode').at(-1)?.data.mode
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'grok-access-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir}
test('persistent grants and direct apply cannot widen native permissions',async t=>{
 const dir=await setup(t),access=new BotAccess(dir),a=agent('a')
 a.session.append('sandbox/mode',{mode:'read-only'});await access.register('chief',a)
 for(const value of [true,'full',1,undefined]){
  await assert.rejects(access.set('chief',value),/已停用/)
 }
 await assert.rejects(access.apply('chief',a,true),/已停用/)
 assert.equal(mode(a),'read-only');assert.equal(access.isFull('chief'),false)
 await access.set('chief',false);assert.equal(mode(a),'read-only')
 assert.deepEqual(JSON.parse(await readFile(join(dir,'bot-access.json'),'utf8')).fullBots,[])
})
test('restart clears legacy grants and restores dormant native sessions once',async t=>{
 const dir=await setup(t),baseline={botId:'chief',mode:'read-only',policy:'never'}
 await writeFile(join(dir,'bot-access.json'),JSON.stringify({fullBots:['chief'],baselines:{a:baseline}}))
 const access=new BotAccess(dir);await access.ready;assert.equal(access.isFull('chief'),false)
 const saved=JSON.parse(await readFile(join(dir,'bot-access.json'),'utf8'));assert.deepEqual(saved.fullBots,[]);assert.deepEqual(saved.baselines.a,baseline)
 await access.set('chief',false);assert.deepEqual(access.data.baselines.a,baseline)
 const a=agent('a');a.session.append('sandbox/mode',{mode:'danger-full-access'})
 await access.register('chief',a);assert.equal(mode(a),'read-only');assert.equal(a.session.events.at(-1).data.policy,'never')
 const count=a.session.events.length;await access.register('chief',a);assert.equal(a.session.events.length,count)
 const restarted=new BotAccess(dir);await restarted.ready;assert.deepEqual(restarted.data.baselines,{})
})
test('unsafe or mismatched legacy baseline blocks registration without permission events',async t=>{
 for(const baseline of [null,{botId:'other',mode:'read-only',policy:'ask'},{botId:'chief',mode:'danger-full-access',policy:'ask'},{botId:'chief',mode:'workspace-write',policy:'allow'}]){
  const dir=await setup(t);await writeFile(join(dir,'bot-access.json'),JSON.stringify({fullBots:['chief'],baselines:{a:baseline}}))
  const access=new BotAccess(dir),a=agent('a');await assert.rejects(access.register('chief',a))
  assert.equal(a.session.events.length,0);assert.equal(access.agents.has(a),false);assert.deepEqual(access.data.baselines.a,baseline)
 }
})
test('failed native restoration retains baseline for retry',async t=>{
 const dir=await setup(t);await writeFile(join(dir,'bot-access.json'),JSON.stringify({fullBots:['chief'],baselines:{a:{botId:'chief',mode:'workspace-write',policy:'ask'}}}))
 const access=new BotAccess(dir),a=agent('a'),append=a.session.append
 a.session.append=()=>{throw Error('native failed')};await assert.rejects(access.register('chief',a),/native failed/)
 assert.ok(access.data.baselines.a);a.session.append=append;await access.register('chief',a);assert.equal(mode(a),'workspace-write')
})
test('ungranted unsupported sessions remain compatible and inherited IDs are ignored',async t=>{
 const access=new BotAccess(await setup(t));await access.register('chief',{session:{}});await access.register('chief',agent('__proto__'))
 await assert.rejects(access.set('chief',true),/已停用/)
})
test('tool arguments unwrap JSON wrappers without corrupting literal escapes',()=>{
 const args={new_string:'line\nnext',command:'printf "\\n"'}
 assert.deepEqual(decodeToolArguments(JSON.stringify(JSON.stringify(args))),args)
 assert.equal(decodeToolArguments('not-json'),null);assert.equal(decodeToolArguments('[]'),null)
})
