import {projectResultJSON} from '../src/chief-context.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {rememberFact,memoryPrompt} from '../src/bot-memory.mjs'
import vm from 'node:vm'
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'bot-memory-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const dir=join(root,'bots','chief','memory');await mkdir(dir,{recursive:true})
 const path=join(dir,'PROFILE.md');await writeFile(path,'# Memory\n')
 return {root,dir,path}
}
test('concurrent memories preserve facts and deduplicate retry',async t=>{
 const {root,path}=await fixture(t)
 const results=await Promise.all(['偏好简洁中文','偏好原群继续','偏好简洁中文'].map(f=>rememberFact(root,'chief',f)))
 assert.deepEqual(results.map(r=>r.stored),[true,true,false])
 const saved=await readFile(path,'utf8')
 assert.equal(saved.match(/偏好简洁中文/g).length,1)
 assert.match(saved,/偏好原群继续/)
})
test('invalid identity, credentials, multiline, and oversized memories fail closed',async t=>{
 const {root,path}=await fixture(t)
 await assert.rejects(rememberFact(root,'../other','fact'))
 for(const fact of ['', 'line\nline','password=secret123','x'.repeat(1001)])await assert.rejects(rememberFact(root,'chief',fact))
 assert.equal(await readFile(path,'utf8'),'# Memory\n')
 await writeFile(path,'x'.repeat(65536))
 await assert.rejects(rememberFact(root,'chief','new'))
})
test('symlink file and parent cannot redirect host memory writes',async t=>{
 const {root,dir,path}=await fixture(t)
 const outside=join(root,'outside');await writeFile(outside,'untouched')
 await rm(path);await symlink(outside,path)
 await assert.rejects(rememberFact(root,'chief','fact'))
 assert.equal(await readFile(outside,'utf8'),'untouched')
 await rm(dir,{recursive:true});await mkdir(join(root,'elsewhere'))
 await writeFile(join(root,'elsewhere','PROFILE.md'),'other')
 await symlink(join(root,'elsewhere'),dir)
 await assert.rejects(rememberFact(root,'chief','fact'))
 assert.equal(await readFile(join(root,'elsewhere','PROFILE.md'),'utf8'),'other')
})
test('both runtime injection paths use the scoped tool and permission denial is not a rating',async()=>{
 const source=await readFile(new URL('../src/index.mjs',import.meta.url),'utf8')
 assert.equal(source.match(/text: memoryPrompt\(profile\)/g).length,2)
 assert.match(source,/rememberFact\(stateDir,bot.id,params.fact\)/)
 const start=source.indexOf('const approvalMatch =')
 const end=source.indexOf('const feedbackMatch =',start)
 assert.doesNotMatch(source.slice(start,end),/awardBot|expDelta/)
 assert.match(memoryPrompt(),/保存失败不阻塞/)
})
test('production tool closure cannot redirect the writer with supplied identity or path',async t=>{
 const {root,path}=await fixture(t)
 const source=await readFile(new URL('../src/index.mjs',import.meta.url),'utf8')
 const start=source.indexOf('  function teamManagementTools(')
 const end=source.indexOf('  function personaPrompt(',start)
 const context={projectResultJSON,stateDir:root,rememberFact,safeError:e=>e.message,ROLE_PROFILES:{},RETRO_RULES:'',crewState:{crew:{conversations:[]}}}
 vm.createContext(context)
 vm.runInContext(source.slice(start,end),context)
 const tool=context.teamManagementTools({id:'chief'}).find(t=>t.name==='bot_remember')
 const result=JSON.parse(await tool.execute({fact:'只记录稳定偏好',botId:'other',file_path:'/tmp/not-authorized'}))
 assert.equal(result.ok,true)
 assert.match(await readFile(path,'utf8'),/只记录稳定偏好/)
 assert.equal(tool.parameters.additionalProperties,false)
})
