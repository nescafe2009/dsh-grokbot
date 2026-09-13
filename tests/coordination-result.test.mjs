import {currentPlanContext} from '../src/chief-context.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {LONG_TASK_RULES} from '../src/job-progress.mjs'
import {WakeScheduler} from '../src/dispatch.mjs'
const source=await readFile(new URL('../src/index.mjs',import.meta.url),'utf8')
const start=source.indexOf('  async function chiefCoordinationTurn('),end=source.indexOf('  async function deliverProjectHandoff(',start)
assert.ok(start>0&&end>start)
async function run(outcome,{writeFails=false, beforeInput=null, duringRead=null,afterExecution=null}={}){
 const messages=[],logs=[],timers=[]
 const wake=new WakeScheduler({fire(){},delay:(ms,fn)=>{timers.push(fn);return timers.length},cancelDelay(){}})
 wake.request('g')
 const state={status:'idle'}
 const c={currentPlanContext,prepareProjectHandoff:async()=>{},projectCanRun:async()=>true,disposed:false,LONG_TASK_RULES,crewState:{crew:{bots:[{id:'chief'}],conversations:[{id:'g',name:'G'}]}},botState:()=>state,coordinationClaims:new Set(),busyProbes:new Map(),chiefWake:wake,readRoomMsgs:async()=>{if(duringRead)await duringRead(wake);return [{role:'system',text:'member failed'}]},logWake:x=>logs.push(x),chiefProjectContext:async()=>({}),readPlan:async()=>({}),stateDir:'/fixture',chatTurn:async(bot,input)=>{if(beforeInput)await beforeInput(wake,state);if(typeof input==='function')await input();if(afterExecution)await afterExecution(state);return outcome},appendRoomMsg:async(id,msg)=>{if(writeFails)throw Error('disk full');messages.push(msg)},ctx:{logger:{}},safeError:String,Date,clearInterval,setInterval}
 vm.createContext(c);vm.runInContext(source.slice(start,end)+'globalThis.run=chiefCoordinationTurn',c)
 await c.run('g');return {wake,messages,logs,state}
}
test('coordination does not acknowledge provider error, partial reply, empty output or persistence failure',async()=>{
 for(const [outcome,options] of [[{text:'partial',error:'timeout'},{}],[{text:''},{}],[{text:'report'},{writeFails:true}]]){
  const r=await run(outcome,options);assert.equal(r.wake.state.get('g').pending,true);assert.equal(r.wake.state.get('g').failBudget,1)
  assert.ok(r.logs.some(l=>l.kind==='error'));assert.ok(!r.logs.some(l=>l.kind==='done'));assert.equal(r.state.status,'idle')
 }
})
test('coordination acknowledges only a persisted valid report',async()=>{
 const r=await run({text:'verified report'});assert.equal(r.messages.length,1);assert.equal(r.wake.state.get('g').pending,false);assert.equal(r.wake.state.get('g').inTransit,false);assert.ok(r.logs.some(l=>l.kind==='done'))
})


test('new event during asynchronous digest read survives successful acknowledgement', async () => {
 const r=await run({text:'report'}, {duringRead:async wake=>wake.request('g')})
 assert.equal(r.wake.state.get('g').pending,true)
})

test('coordination defers state reads until executor admits the turn', async () => {
 let entered=false
 await run({text:'report'}, {beforeInput:async()=>{entered=true},duringRead:async()=>assert.equal(entered,true)})
})


test('native cancellation retains pending work but schedules no automatic retry', async () => {
 const r=await run({text:'partial',cancelled:true})
 const st=r.wake.state.get('g')
 assert.equal(st.pending,true);assert.equal(st.inTransit,false)
 assert.equal(st.failBudget,-1);assert.equal(st.timer,undefined)
 assert.equal(r.messages.length,0)
 assert.ok(r.logs.some(l=>l.kind==='cancelled'))
})

test('queued coordination is not working and completion cannot reset a subsequent executor',async()=>{
 const result=await run({text:'verified report'},{beforeInput:async(wake,state)=>assert.equal(state.status,'idle'),afterExecution:async state=>{state.status='working';state.currentJob='next-turn'}})
 assert.equal(result.state.status,'working')
 assert.equal(result.state.currentJob,'next-turn')
})

test('events while waiting for the executor are coalesced into its fresh snapshot',async()=>{
 const r=await run({text:'current report'},{beforeInput:async wake=>wake.request('g')})
 assert.equal(r.wake.state.get('g').pending,false)
 assert.equal(r.wake.state.get('g').inTransit,false)
 assert.equal(r.messages.length,1)
})
