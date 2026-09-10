import test from 'node:test'
import assert from 'node:assert/strict'
import {parseCrew,serializeCrew,normalizeModelPresets,DEFAULT_CREW} from '../src/crew.mjs'
test('model presets persist independently of existing bot selections',()=>{
 const raw={...DEFAULT_CREW,modelPresets:[{name:' 快速 ',provider:'service',model:'custom/model'}],defaultModel:{provider:'service',model:'legacy'}}
 const crew=parseCrew(JSON.stringify(raw));const restored=parseCrew(serializeCrew(crew))
 assert.deepEqual(restored.modelPresets,[{name:'快速',provider:'service',model:'custom/model'}]);assert.equal(restored.defaultModel.model,'legacy')
 restored.modelPresets=[];assert.equal(parseCrew(serializeCrew(restored)).defaultModel.model,'legacy')
 assert.deepEqual(parseCrew(JSON.stringify(DEFAULT_CREW)).modelPresets,[])
})
test('model preset validation rejects malformed and duplicate entries',()=>{
 assert.throws(()=>normalizeModelPresets([{provider:'p',model:''}]))
 assert.throws(()=>normalizeModelPresets([{provider:'p',model:'m'},{provider:'p',model:'m'}]))
 assert.throws(()=>normalizeModelPresets(Array(31).fill({provider:'p',model:'m'})))
 assert.equal(normalizeModelPresets([{provider:'p',model:'m'},{provider:'q',model:'m'}]).length,2)
})
