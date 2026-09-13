import {sessionEvents} from '../src/session-events.mjs'
import test from 'node:test'
import { chatFailureNotice } from '../src/index.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises';import vm from 'node:vm';
const s=await fs.readFile('./src/index.mjs','utf8');let now=0,fail=false;const logs=[];const c={sessionEvents,crewState:{crew:{conversations:[]}},projectCanRun:async()=>true,selectedModel:()=>null,chatFailureNotice,Date:class extends Date{static now(){return now}},stateDir:'/tmp/mock',validateTaskForContext:async()=>({ok:true,task:null}),botWorkspace:()=>'/tmp/mock',realpath:async x=>x,runExclusively:async(_,f)=>{now+=1000;return f()},setTurnCtx(){},activeTurnCtx:new Map(),botState:()=>({status:'idle'}),chatHandles:new Map([['g:b',{model:null,handle:{agent:{session:{seq:0,events:[]},whenIdle:async()=>{if(fail)throw new Error('agent failure');now+=5},followup(){}}}}]]),readRoomMsgs:async()=>[],readDm:async()=>[],relevantUserHistory:()=>[],userMessage:x=>x,summarizeTurn:()=>({text:'ok'}),activityOf:()=>[],shellExecutionEvidence:()=>({shellOk:false,targetMatch:false}),isCancelStopReason:(v)=>/abort|cancel/i.test(String(v??'')),cancelledRunIds:new Set(),resolveTurnFinalOutcome:()=>({finalStatus:'done'}),closeActiveRun:async()=>({status:'done'}),safeError:String,logPerf:x=>logs.push(x)};vm.createContext(c);vm.runInContext(s.slice(s.indexOf('  async function chatTurn('),s.indexOf('  function eligibleBots'))+'globalThis.turn=chatTurn;',c);const r=await c.turn({id:'b'},'test',{conversationId:'g',writeDm:false});assert.equal(now,1010);assert.equal(r.perf.totalMs,1010);assert.equal(r.perf.queueMs,1000);assert.equal(r.perf.executionMs,10);console.log('PASS queue1000 execution10 total1010');logs.length=0;fail=true;await assert.rejects(c.turn({id:'b'},'test',{conversationId:'g',writeDm:false}));assert.equal(logs.length,1);console.log('PASS thrown failure logged');
let disposed=0;const d={method:'POST',suffix:'/__perf/direct',testEndpointsOn:true,readJsonBody:async()=>({text:'test'}),req:{},res:{},stateDir:'/tmp/mock',join:(...xs)=>xs.join('/'),randomUUID:()=> 's',crewState:{crew:{}},ctx:{agents:{create:async()=>({agent:{whenIdle:async()=>{throw new Error('idle failed')}},dispose:async()=>disposed++})}},logPerf(){},safeError:String,HttpError:Error};
// 提取边界显式断言：源码条件改写（如再加门控）时立即在此失败，而非切片为空块后 Missing expected rejection
const dStart=s.indexOf("        if (testEndpointsOn && method === 'POST' && suffix === '/__perf/direct')");const dEnd=s.indexOf('        // 预览 POST 边界测试端点');assert.ok(dStart>0,'__perf/direct 起点提取失效（源码条件已变）');assert.ok(dEnd>dStart,'__perf/direct 终点提取失效');
vm.createContext(d);vm.runInContext('globalThis.direct=async()=>{'+s.slice(dStart,dEnd)+'};',d);await assert.rejects(d.direct());assert.equal(disposed,1);console.log('PASS direct exception disposes handle (testEndpointsOn 上下文)');

fail=false;logs.length=0;c.closeActiveRun=async()=>({status:"cancelled"});const cr=await c.turn({id:"b"},"test",{conversationId:"g",writeDm:false});assert.equal(cr.cancelled,true);assert.equal(logs[0].cancelled,true);assert.equal(logs[0].error,null);console.log("PASS final cancelled outcome logged cancelled");

fail=true;logs.length=0;c.activeTurnCtx.set('g:b',{runId:'r'});c.cancelledRunIds.add('r');const ar=await c.turn({id:'b'},'test',{conversationId:'g',writeDm:false});assert.equal(ar.cancelled,true);assert.ok(ar.perf);assert.equal(ar.perf.status,'cancelled');assert.equal(logs.length,1);console.log('PASS abort cancellation returns perf and one cancelled log');


// ===== group-probe：群透传 + cancelled API 性能 =====
{
  const gs = s // 复用同一份源文件内容
  const bot = {id:'a',name:'A'}
  const gOutcome = {text:'partial',cancelled:true,perf:{totalMs:12,executionMs:10,queueMs:2,toolCalls:1}}
  const gc = {crewState:{crew:{bots:[bot,{id:'b',name:'B'}]}},pickResponder:()=>bot,readRoomMsgs:async()=>[],appendRoomMsg:async()=>{},chatTurn:async()=>gOutcome,HANDOFF_LINE_RE:/^@never/}
  vm.createContext(gc)
  vm.runInContext(gs.slice(gs.indexOf('  async function conversationTurn('),gs.indexOf('  // ---------- 幕僚长协调'))+'globalThis.turn=conversationTurn;',gc)
  const gr = await gc.turn({id:'g',name:'G',memberBotIds:['a','b']},'test')
  assert.equal(gr.outcome, gOutcome)
  const log = {turnMs: gr?.outcome?.perf?.totalMs ?? null, cancelled: gr?.outcome?.cancelled ?? false, status: gr?.outcome?.cancelled ? 'cancelled' : (gr?.outcome?.error ? 'failed' : (gr?.reply ? 'ok' : 'empty'))}
  assert.equal(log.status, 'cancelled')
  assert.equal(log.cancelled, true)
  assert.equal(log.turnMs, 12)
  console.log('PASS cancelled group API performance', JSON.stringify(log))
}
