import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {appendTranscript} from '../src/transcript.mjs'

test('concurrent outbox delivery and reload deduplicate by durable identity only',async()=>{
 const root=await mkdtemp(join(tmpdir(),'transcript-')),path=join(root,'dm.jsonl')
 try{
  const entry={role:'bot',text:'[成果](/artifact/one)',messageId:'handoff-abc'}
  await Promise.all(Array.from({length:8},()=>appendTranscript(path,entry)))
  await appendTranscript(path,entry)
  await appendTranscript(path,{...entry,messageId:'handoff-def'})
  const messages=(await readFile(path,'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(messages.length,2)
  assert.equal(messages[0].text,messages[1].text)
 }finally{await rm(root,{recursive:true,force:true})}
})
