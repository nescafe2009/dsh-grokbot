import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {migrateDeliveryIdentity} from '../src/project-identity.mjs'
import {acceptedStep,deliveryFingerprint,stepFingerprint} from '../src/project-lifecycle.mjs'
import {savePlan} from '../src/project-board.mjs'
import {eligibleDependencyRetry} from '../src/project-status.mjs'
import {jobMatchesStep,validateDispatch} from '../src/project-rework.mjs'
const step=(id,deps=[],jobs=[`job-${id}`])=>({id,title:id,botId:'worker',dependsOn:deps,jobIds:jobs})
const state=()=>({version:1,conversationId:'room',status:'active',epoch:0,revision:1,reviews:{},history:[]})
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'project-system-'));try{await fn(root)}finally{await rm(root,{recursive:true,force:true})}}
async function save(root,s,steps){for(const dir of ['project-lifecycle','project-plans'])await mkdir(join(root,dir),{recursive:true});await writeFile(join(root,'project-lifecycle','room.json'),JSON.stringify(s));await writeFile(join(root,'project-plans','room.json'),JSON.stringify({revision:1,steps}))}
function approve(s,a){s.reviews[a.id]={fingerprint:deliveryFingerprint(s,a),dependencyFingerprints:Object.fromEntries(a.dependsOn.map(id=>[id,s.reviews[id].fingerprint])),actor:'user',evidence:'实际确认'}}

test('identity migration preserves valid dependency chain and later history links, with idempotent upgrade',()=>fixture(async root=>{
 const s=state(),a=step('a'),b=step('b',['a']);approve(s,a);approve(s,b);await save(root,s,[a,b])
 const next=await migrateDeliveryIdentity(root,'room');assert(acceptedStep(next,b,[a,b]));assert.equal(next.reviews.b.dependencyFingerprints.a,next.reviews.a.fingerprint)
 const changed={...a,jobIds:[...a.jobIds,'historical-repair']};assert(acceptedStep(next,changed,[changed,b]));assert(acceptedStep(next,b,[changed,b]))
 const twice=await migrateDeliveryIdentity(root,'room');assert.equal(twice.revision,next.revision);assert.deepEqual(twice.history,next.history)
}))
test('migration never revives previously invalid legacy approval, including a fingerprint equal to new identity',()=>fixture(async root=>{
 const s=state(),a=step('a');approve(s,{...a,jobIds:[]});assert.equal(acceptedStep(s,a,[a]),false);await save(root,s,[a]);const next=await migrateDeliveryIdentity(root,'room');assert.equal(acceptedStep(next,a,[a]),false)
}))
test('migration preserves invalid dependent approval when its recorded dependency no longer matches',()=>fixture(async root=>{
 const s=state(),a=step('a'),b=step('b',['a']);approve(s,a);approve(s,b);s.reviews.b.dependencyFingerprints.a='outdated-dependency';await save(root,s,[a,b]);const next=await migrateDeliveryIdentity(root,'room');assert.equal(acceptedStep(next,b,[a,b]),false)
}))
test('automatic retry requires unstarted dependency cancellation and matching current scope',()=>{
 const s={...state(),deliveryIdentityVersion:2},a=step('a'),b=step('b',['a']);approve(s,a)
 const job={jobId:'old',projectStep:{id:'b',fingerprint:stepFingerprint({...b,jobIds:[]}),generation:0},record:{status:'cancelled',reason:'工作包范围或依赖在排队后发生变化',startedAt:null}}
 assert.equal(eligibleDependencyRetry(s,b,[a,b],[job]),job);assert.equal(jobMatchesStep(s,b,[a,b],job),true)
 assert.equal(eligibleDependencyRetry(s,b,[a,b],[{...job,record:{...job.record,startedAt:10}}]),null)
 assert.equal(eligibleDependencyRetry(s,b,[a,b],[{...job,record:{...job.record,reason:'用户取消'}}]),null)
 assert.equal(eligibleDependencyRetry(s,b,[a,b],[job,{...job,record:{status:'queued'}}]),null)
 assert.equal(jobMatchesStep(s,{...b,title:'different scope'},[a,b],job),false)
 assert.equal(jobMatchesStep({...s,stepGenerations:{b:1}},b,[a,b],job),false)
})
test('explicit final delivery cannot omit a required branch or dispatch before branch approval',()=>fixture(async root=>{
 const s={...state(),deliveryIdentityVersion:2},a=step('a',[],[]),audio=step('audio',[],[]),final={...step('final',['a'],[]),finalDelivery:true};await save(root,s,[])
 await assert.rejects(savePlan(root,'room',[a,audio,final],['worker'],[],1),/全部必交付/)
 const complete={...final,dependsOn:['a','audio']};await savePlan(root,'room',[a,audio,complete],['worker'],[],1)
 approve(s,a);assert.throws(()=>validateDispatch(s,complete,[a,audio,complete],[],{toBot:'worker'}),/前置|必交付/)
}))
