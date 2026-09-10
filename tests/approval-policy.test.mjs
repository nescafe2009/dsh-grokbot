import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,symlink,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import vm from 'node:vm'
import {decodeToolArguments} from '../src/bot-access.mjs'
import {approvalScope,parseApprovalReview} from '../src/approval-policy.mjs'
const source=await readFile(new URL('../src/index.mjs',import.meta.url),'utf8')
const start=source.indexOf("  ctx.effect(() => ctx.on('approval/request'")
const end=source.indexOf('  const ROLE_TEMPLATES',start)
assert.ok(start>0 && end>start)
function harness(root,stream) {
 const pending=new Map(), notices=[], cleanups=[]; let handler, timer
 const context={botAccess:{isFull:()=>false},decodeToolArguments,activeTurnCtx:new Map(),botState:()=>({}),approvalScope,parseApprovalReview,AbortController,
 setTimeout:f=>{timer=f;return 1},clearTimeout(){},
 approvalBotByAgent:new Map([['agent','member']]),pendingApprovals:pending,
 crewState:{crew:{bots:[{id:'chief'},{id:'member',name:'成员'}]}},
 selectedModel:()=>({provider:'test',model:'test'}),userMessage:text=>({content:[{type:'text',text}]}),contentText:()=> 'Read the project document',chunkText:()=>'',
 appendDm:async(id,entry)=>notices.push({id,...entry}),
 ctx:{llm:{stream},effect:f=>{const d=f();if(typeof d==='function')cleanups.push(d)},on:(name,h)=>{handler=h;return ()=>{} }}}
 vm.runInNewContext(source.slice(start,end),context)
 return {pending,notices,timeout:()=>timer(),close:()=>cleanups.forEach(f=>f()),request(tool='read',args={path:'note.txt'}) {
  const abort=new AbortController()
  const promise=handler({agent:{id:'agent',session:{header:{cwd:root},events:[{type:'tool/call',data:{callId:'call',arguments:args}},{type:'approval/asked',data:{id:'approval',callId:'call'}}]}},toolName:tool,callId:'call',signal:abort.signal},()=> 'host')
  return {promise,abort}
 }}
}
const flush=async(check)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,5))}assert.fail('approval did not settle')}
async function* allow(){yield {type:'text-delta',delta:'{"decision":"allow","reason":"读取任务文档"}'};yield {type:'finish',reason:{kind:'stop'}}}
test('file scope excludes outside paths, symlinks, secrets, configuration, shell and unknown targets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'approval-'))
 try{
 await writeFile(join(root,'note.txt'),'test'); await writeFile(join(root,'.env'),'private');await writeFile(join(root,'package.json'),'{}');await symlink('/etc/hosts',join(root,'outside'))
 assert.equal((await approvalScope({workspace:root,toolName:'read',args:{path:'note.txt'}})).eligible,true)
 for(const [toolName,path] of [['read','outside'],['read','.env'],['write','package.json'],['write','new.txt'],['bash','note.txt'],['read','/etc/hosts']]) assert.equal((await approvalScope({workspace:root,toolName,args:{path}})).eligible,false,`${toolName} ${path}`)
 assert.equal(parseApprovalReview('sure, allow'),null)
 assert.equal(parseApprovalReview('{"decision":"allow","reason":""}'),null)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('production approval bridge: chief allow, escalation, human decision, cancellation and timeout late result',async()=>{
 const root=await mkdtemp(join(tmpdir(),'approval-'))
 try{
 await writeFile(join(root,'note.txt'),'test')
 const h=harness(root,allow);assert.equal(await h.request().promise,'allowed-once');assert.equal(h.pending.size,0);assert.equal(h.notices[0].id,'chief');assert.match(h.notices[0].text,/幕僚长代审/)
 let calls=0
 const danger=harness(root,()=>{calls++;return allow()});const req=danger.request('bash',{command:'sudo rm -rf something'})
 await flush(()=>danger.pending.get('approval')?.stage==='user');assert.equal(calls,0);assert.match(danger.notices[0].text,/需要你审批/)
 danger.pending.get('approval').resolve('rejected','user');assert.equal(await req.promise,'rejected');assert.equal(danger.pending.size,0)
 const unavailable=harness(root,async function*(){throw Error('quota')});const q=unavailable.request();await flush(()=>unavailable.pending.get('approval')?.stage==='user');q.abort.abort();assert.equal(await q.promise,'cancelled')
 let release, entered=false
 const slow=harness(root,async function*(){entered=true;await new Promise(r=>release=r);yield* allow()})
 const s=slow.request();await flush(()=>entered);slow.timeout();assert.equal(slow.pending.get('approval').stage,'user');release();await new Promise(r=>setTimeout(r,10));assert.equal(slow.pending.get('approval').stage,'user');s.abort.abort();assert.equal(await s.promise,'cancelled')
 release=undefined;const cancel=harness(root,async function*(){await new Promise(r=>release=r);yield* allow()});const c=cancel.request();await flush(()=>typeof release==='function');c.abort.abort();release();assert.equal(await c.promise,'cancelled');assert.equal(cancel.pending.size,0);assert.equal(cancel.notices.length,0)
 }finally{await rm(root,{recursive:true,force:true})}
})
