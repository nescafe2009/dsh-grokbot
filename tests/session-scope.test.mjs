import test from 'node:test'
import assert from 'node:assert/strict'
import {parseSessionKey,resolveSessionOwner} from '../src/session-scope.mjs'

test('session scope parses DM, group and custom workspace without corrupting bot identity',()=>{
 assert.deepEqual(parseSessionKey('chief:chief'),{sessionKey:'chief:chief',botId:'chief',conversationId:null,workspace:null})
 assert.deepEqual(parseSessionKey('project:chief'),{sessionKey:'project:chief',botId:'chief',conversationId:'project',workspace:null})
 assert.deepEqual(parseSessionKey('project:chief|ws:/tmp/a:b'),{sessionKey:'project:chief|ws:/tmp/a:b',botId:'chief',conversationId:'project',workspace:'/tmp/a:b'})
 assert.equal(parseSessionKey('broken'),null)
 assert.equal(resolveSessionOwner(new Map([['project:chief|ws:/tmp/a:b','session-1']]),'session-1').botId,'chief')
})
