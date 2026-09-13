import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {archiveLibrary} from '../src/archive-library.mjs'
import {deliveryFingerprint} from '../src/project-lifecycle.mjs'
test('archive catalog respects project identity, archive cutoff, snapshot versions and actual acceptance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'archive-lib-'))
 try{
  await mkdir(join(root,'project-lifecycle'))
  const step={id:'s1',title:'阶段',botId:'b',dependsOn:[],jobIds:[]}
  const state={version:1,deliveryIdentityVersion:2,status:'archived',revision:1,epoch:1,history:[],reviews:{},snapshot:{archivedAt:100,plan:{steps:[step]}}}
  state.reviews.s1={fingerprint:deliveryFingerprint(state,step)}
  await writeFile(join(root,'project-lifecycle','room.json'),JSON.stringify(state))
  for(const [id,time,room,path,missing]of[['first',10,'room','/same'],['last',90,'room','/same'],['future',110,'room','/same'],['foreign',50,'other','/same'],['otherpath',50,'room','/different'],['missing',60,'room','/missing',true]]){
   const folder=join(root,'artifacts',id);await mkdir(join(folder,'data'),{recursive:true})
   await writeFile(join(folder,'meta.json'),JSON.stringify({name:'index.html',mime:'text/html; charset=utf-8',conversationId:room,sourcePath:path,createdAt:time}));if(!missing)await writeFile(join(folder,'data/payload'),'snapshot')
  }
  const crew={bots:[{id:'b',name:'成员'}],conversations:[{id:'room',name:'项目',memberBotIds:['chief','b']},{id:'other',name:'项目',memberBotIds:['chief','b']}]}
  const result=await archiveLibrary(root,crew);assert.equal(result.projects.length,1)
  const p=result.projects[0];assert.equal(p.accepted,1);assert.equal(p.total,1);assert.equal(p.artifacts.length,2)
  assert.deepEqual(p.artifacts[0].versions.map(a=>a.id),['last','first']);assert.ok(!JSON.stringify(result).includes('/same'));assert.ok(!JSON.stringify(result).includes('future'))
  state.reviews={};await writeFile(join(root,'project-lifecycle/room.json'),JSON.stringify(state));assert.equal((await archiveLibrary(root,crew)).projects[0].accepted,0)
  await writeFile(join(root,'project-lifecycle/room.json'),'broken');assert.equal((await archiveLibrary(root,crew)).warnings.length,1)
 }finally{await rm(root,{recursive:true,force:true})}
})
