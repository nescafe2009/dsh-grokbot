import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCrew, createBot, updateBot, removeBot, duplicateBot, botWorkspace } from '../src/crew.mjs'

function baseCrew() {
  return parseCrew(JSON.stringify({
    routing: { default: 'chief' },
    bots: [{ id: 'chief', name: '幕僚长', pinned: true }],
  }))
}

test('createBot：生成唯一 id 并入队', () => {
  const crew = baseCrew()
  const bot = createBot(crew, { name: '调研员 小赵', avatar: '🔎', title: '检索与情报' })
  assert.ok(bot.id && bot.id !== 'chief')
  assert.match(bot.id, /-/)
  assert.equal(bot.name, '调研员 小赵')
  assert.equal(crew.bots.length, 2)
  assert.equal(bot.hidden, false)
  assert.equal(bot.pinned, false)
})

test('createBot：id 冲突与上限校验', () => {
  const crew = baseCrew()
  assert.throws(() => createBot(crew, { id: 'chief', name: 'x' }), /已存在/)
  const many = parseCrew(JSON.stringify({ routing: { default: 'a' }, bots: [{ id: 'a' }] }))
  many.bots = Array.from({ length: 50 }, (_, i) => ({ id: `b${i}`, name: `b${i}` }))
  assert.throws(() => createBot(many, { name: 'overflow' }), /50/)
})

test('updateBot：可编辑字段生效，非法字段拒绝，默认收件人不可隐藏', () => {
  const crew = baseCrew()
  const bot = updateBot(crew, 'chief', { title: '总管', persona: '新的规则', pinned: true })
  assert.equal(bot.title, '总管')
  assert.equal(bot.persona, '新的规则')
  assert.throws(() => updateBot(crew, 'chief', { id: 'hack' }), /不可编辑字段/)
  updateBot(crew, 'chief', { hidden: true })
  assert.equal(crew.bots[0].hidden, false)
  assert.throws(() => updateBot(crew, 'ghost', { name: 'x' }), /不存在/)
})

test('removeBot：最后一个不可删；删默认收件人自动改指', () => {
  const crew = baseCrew()
  assert.throws(() => removeBot(crew, 'chief'), /至少保留/)
  createBot(crew, { id: 'second', name: '二把手' })
  removeBot(crew, 'chief')
  assert.equal(crew.routing.default, 'second')
  assert.equal(crew.bots.length, 1)
})

test('duplicateBot：复制 profile 不复制 id/置顶/隐藏', () => {
  const crew = baseCrew()
  const copy = duplicateBot(crew, 'chief')
  assert.notEqual(copy.id, 'chief')
  assert.equal(copy.name, '幕僚长 副本')
  assert.equal(copy.pinned, false)
  assert.equal(crew.bots.length, 2)
})

test('botWorkspace：全队共享 workspace，覆盖除外', () => {
  const crew = baseCrew()
  assert.equal(botWorkspace('/state', crew.bots[0]), '/state/workspace')
  const solo = parseCrew(JSON.stringify({ routing: { default: 'a' }, bots: [{ id: 'a', workspace: '/data/solo' }] }))
  assert.equal(botWorkspace('/state', solo.bots[0]), '/data/solo')
})
