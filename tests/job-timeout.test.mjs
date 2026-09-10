import test from 'node:test'
import assert from 'node:assert/strict'
import {classifyJobTimeout} from '../src/index.mjs'
test('job deadline overrides a successful-looking partial response and preserves it for recovery',()=>{
 const partial={text:'Let me write the next module',error:'',stopReason:'cancelled'}
 const result=classifyJobTimeout(partial,true,600000)
 assert.equal(result.stopReason,'error');assert.match(result.error,/10 分钟/);assert.match(result.error,/尚未完成/);assert.equal(result.text,partial.text)
 assert.equal(partial.error,'')
})
test('normal completion and native failures remain unchanged without a deadline',()=>{
 for(const outcome of [{text:'done',error:'',stopReason:'completed'},{text:'partial',error:'connection lost',stopReason:'error'}])assert.equal(classifyJobTimeout(outcome,false,600000),outcome)
})
