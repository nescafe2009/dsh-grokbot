import test from 'node:test'
import assert from 'node:assert/strict'
import {sessionEvents} from '../src/session-events.mjs'
import {readCharacterPhase} from '../src/character-phase.mjs'
test('fresh native snapshots win over removed legacy getter',()=>{
 const log=[];const session={snapshotEvents(){return Object.freeze([...log])},get events(){throw Error('removed')}}
 const first=sessionEvents(session);log.push({seq:0,type:'tool/call',data:{callId:'x'}})
 assert.equal(first.length,0);assert.equal(sessionEvents(session).length,1)
 assert.equal(readCharacterPhase({session,firstSeq:0}),'working')
 log.push({seq:1,type:'tool/result',data:{callId:'x'}})
 assert.equal(readCharacterPhase({session,firstSeq:0}),'active')
})
test('legacy event arrays work; unsupported API never silently loses evidence',()=>{
 const events=[];assert.equal(sessionEvents({events}),events)
 assert.throws(()=>sessionEvents({}),/SESSION_EVENTS_UNAVAILABLE/)
 assert.throws(()=>sessionEvents({snapshotEvents(){throw Error('read failed')},events}),/read failed/)
})
