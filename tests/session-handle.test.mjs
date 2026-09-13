import test from 'node:test'
import assert from 'node:assert/strict'
import { openSessionHandle } from '../src/session-handle.mjs'

test('native published session is reused without resume or owner teardown', async () => {
  const agent = { session: { id: 'same' } }
  const handle = await openSessionHandle({ get: () => agent, resume: () => assert.fail('duplicate resume') }, 'same', {})
  assert.equal(handle.agent, agent)
  assert.equal(handle.borrowed, true)
  await handle.dispose()
  assert.equal(handle.agent, agent)
})
test('publication race reuses exact session, never creates replacement history', async () => {
  const agent = { session: { id: 'same' } }
  let live = false
  const handle = await openSessionHandle({ get: () => live ? agent : null, resume: async () => {
    live = true
    throw Error('cannot prepare session "same" while it is live')
  } }, 'same', {})
  assert.equal(handle.agent, agent)
})
test('unrelated persistence failures and mismatched agents remain failures', async () => {
  const failure = Error('corrupt log')
  await assert.rejects(openSessionHandle({ get: () => ({ session: { id: 'other' } }), resume: async () => { throw failure } }, 'same', {}), error => error === failure)
})
