import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {captureScreenshot} from '../src/screenshots.mjs'
test('capture is interactive, snapshots only selected file, and cancellation creates no attachment',async()=>{
 const root=await mkdtemp(join(tmpdir(),'grokbot-shot-'))
 try {
  let command
  const result=await captureScreenshot(root,'chief',{platform:'darwin',execute:async(file,args)=>{command={file,args};await writeFile(args.at(-1),Buffer.from('selected image'))}})
  assert.equal(command.file,'/usr/sbin/screencapture');assert.deepEqual(command.args.slice(0,2),['-i','-x'])
  const dir=join(root,'artifacts',result.id),meta=JSON.parse(await readFile(join(dir,'meta.json'),'utf8'))
  assert.equal(meta.conversationId,'chief');assert.equal(meta.kind,'user-screenshot');assert.equal(meta.mime,'image/png')
  assert.equal(await readFile(join(dir,'data','payload'),'utf8'),'selected image')
  assert.deepEqual(await captureScreenshot(root,'chief',{platform:'darwin',execute:async()=>{}}),{cancelled:true})
  await assert.rejects(captureScreenshot(root,'chief',{platform:'linux'}),/暂不支持/)
 } finally {await rm(root,{recursive:true,force:true})}
})
test('delayed capture uses a noninteractive background screenshot and honors cancellation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'grokbot-delay-')),controller=new AbortController()
 try{
  let args,signal
  const result=await captureScreenshot(root,'chief',{platform:'darwin',mode:'screen',delay:5,signal:controller.signal,execute:async(_,a,o)=>{args=a;signal=o.signal;controller.abort();throw Error('aborted')}})
  assert.deepEqual(args.slice(0,-1),['-m','-x','-T','5']);assert.equal(signal,controller.signal);assert.deepEqual(result,{cancelled:true})
  await assert.rejects(captureScreenshot(root,'chief',{delay:30}),/延时无效/)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('clipboard import accepts PNG only and stores a conversation-bound attachment',async()=>{
 const {importScreenshot}=await import('../src/screenshots.mjs'),root=await mkdtemp(join(tmpdir(),'grokbot-paste-'))
 try{
  const data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='
  const r=await importScreenshot(root,'chief',data),m=JSON.parse(await readFile(join(root,'artifacts',r.id,'meta.json'),'utf8'))
  assert.equal(m.kind,'user-screenshot');assert.equal(m.conversationId,'chief')
  await assert.rejects(importScreenshot(root,'chief','data:image/svg+xml;base64,AAAA'),/PNG/)
  await assert.rejects(importScreenshot(root,'chief','data:image/png;base64,AAAA'),/无效/)
 }finally{await rm(root,{recursive:true,force:true})}
})
