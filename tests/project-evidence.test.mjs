import {projectBoard} from '../src/project-board.mjs'
import {validateDispatch} from '../src/project-rework.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {registerProjectEvidence,currentProjectEvidence,evidenceDependencies} from '../src/project-evidence.mjs'
import {deliveryFingerprint,acceptedStep,readLifecycle} from '../src/project-lifecycle.mjs'

async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'project-evidence-'))
 const steps=[{id:'build',title:'Build',botId:'dev',jobIds:[],dependsOn:[]},{id:'qa',title:'QA',botId:'qa',jobIds:['old'],dependsOn:['build']}]
 const state={version:1,deliveryIdentityVersion:2,conversationId:'g',status:'active',epoch:0,revision:4,history:[],reviews:{},stepGenerations:{build:1,qa:1}}
 state.reviews.build={fingerprint:deliveryFingerprint(state,steps[0]),actor:'user'}
 const jobs=[{jobId:'old',conversationId:'g',toBot:'qa',projectEpoch:0,projectStep:{id:'qa',generation:0},record:{status:'replied'},checkpoint:{files:['qa.md']}}]
 const params={stepId:'qa',sourceJobId:'old',expectedRevision:4,expectedEpoch:0,expectedGeneration:1,expectedFingerprint:deliveryFingerprint(state,steps[1]),dependencyFingerprints:evidenceDependencies(state,steps[1]),artifacts:['qa.md'],evidence:'仅排版修订，已复核原测试报告仍覆盖当前接口',actor:'codex'}
 await mkdir(join(root,'project-lifecycle'));await writeFile(join(root,'project-lifecycle','g.json'),JSON.stringify(state))
 try{await fn({root,state,steps,jobs,params,inspect:async()=>({steps,jobs})})}finally{await rm(root,{recursive:true,force:true})}
}
test('re-registers old downstream evidence without jobs or implicit acceptance; repeated exact registration is idempotent',()=>fixture(async f=>{
 const next=await registerProjectEvidence(f.root,'g',f.params,f.inspect)
 assert.equal(next.revision,5);assert.equal(f.jobs.length,1)
 assert.equal(currentProjectEvidence(next,f.steps[1],f.steps,f.jobs).sourceJobId,'old')
 assert.equal(acceptedStep(next,f.steps[1],f.steps),false)
 const again=await registerProjectEvidence(f.root,'g',{...f.params,expectedRevision:5},f.inspect)
 assert.equal(again.revision,5);assert.equal((await readLifecycle(f.root,'g')).history.length,1)
}))
test('rejects stale optimistic versions and absent applicability explanation',()=>fixture(async f=>{
 for(const change of [{expectedRevision:3},{expectedEpoch:1},{expectedGeneration:0},{expectedFingerprint:'old'},{dependencyFingerprints:{}},{evidence:''},{actor:''},{artifacts:['unproven.md']}])await assert.rejects(registerProjectEvidence(f.root,'g',{...f.params,...change},f.inspect))
 assert.equal((await readLifecycle(f.root,'g')).revision,4)
}))
test('cannot import failed, foreign-project, foreign-epoch or wrong-owner work',()=>fixture(async f=>{
 const original=structuredClone(f.jobs[0])
 for(const change of [{record:{status:'failed'}},{record:{status:'cancelled'}},{conversationId:'other'},{projectEpoch:1},{toBot:'dev'}]){
 f.jobs[0]={...original,...change};await assert.rejects(registerProjectEvidence(f.root,'g',f.params,f.inspect),/来源须/)
 }
}))
test('registered evidence expires when dependency, target, source or work state changes',()=>fixture(async f=>{
 const next=await registerProjectEvidence(f.root,'g',f.params,f.inspect),step=f.steps[1]
 for(const mutate of [s=>s.epoch++,s=>s.stepGenerations.qa++,s=>delete s.reviews.build,s=>s.reviews.build.fingerprint='new',s=>s.reworks={qa:{phase:'repair'}},s=>s.status='archived']){
 const changed=structuredClone(next);mutate(changed);assert.equal(currentProjectEvidence(changed,step,f.steps,f.jobs),null)
 }
 const altered=structuredClone(f.jobs);altered[0].checkpoint.files.push('new.md')
 assert.equal(currentProjectEvidence(next,step,f.steps,altered),null)
 assert.equal(currentProjectEvidence(next,{...step,title:'New QA scope'},f.steps,f.jobs),null)
 assert.equal(currentProjectEvidence(next,step,f.steps,[...f.jobs,{jobId:'live',projectStep:{id:'qa'},record:{status:'claimed'}}]),null)
}))
test('active rework and unaccepted dependencies cannot be bypassed',()=>fixture(async f=>{
 for(const mutation of [s=>s.reworks={qa:{phase:'repair'}},s=>delete s.reviews.build]){
 const changed=structuredClone(f.state);mutation(changed);await writeFile(join(f.root,'project-lifecycle','g.json'),JSON.stringify(changed))
 await assert.rejects(registerProjectEvidence(f.root,'g',f.params,f.inspect))
 }
}))

test('registered evidence is visible as pending review and blocks redundant execution',()=>fixture(async f=>{
 const next=await registerProjectEvidence(f.root,'g',f.params,f.inspect)
 await mkdir(join(f.root,'project-plans'));await writeFile(join(f.root,'project-plans','g.json'),JSON.stringify({steps:f.steps,revision:1}))
 const inbox=join(f.root,'inbox');await mkdir(join(inbox,'old'),{recursive:true})
 await writeFile(join(inbox,'queue.jsonl'),JSON.stringify(f.jobs[0])+'\n')
 await writeFile(join(inbox,'old','status.json'),JSON.stringify(f.jobs[0].record));await writeFile(join(inbox,'old','checkpoint.json'),JSON.stringify(f.jobs[0].checkpoint))
 const b=await projectBoard({stateDir:f.root,inboxRoot:inbox,conversationId:'g',bots:[]})
 const row=b.rows.find(r=>r.id==='qa')
 // A fixture has no build execution; project board must continue to show its dependency accurately.
 assert.equal(row.deliveryEvidence.sourceJobId,'old');assert.deepEqual(row.checkpoint.files,['qa.md']);assert.equal(row.accepted,false)
 assert.throws(()=>validateDispatch(next,f.steps[1],f.steps,f.jobs,{toBot:'qa'}),/已有成果/)
}))
