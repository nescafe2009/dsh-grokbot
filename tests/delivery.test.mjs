import test from 'node:test'
import assert from 'node:assert/strict'
import { isInsideRoot, classifyDeliveryTarget } from '../src/delivery-core.mjs'

// —— R1 交付链回归（Codex 三/四轮审查项固化）——
// 覆盖：相邻目录越界、symlink 解析后包含、`..` 前缀文件名不误拒、
// 根别名（realpath 后一致）、DM/群/已删群路由分类。

test('isInsideRoot：直接子文件与深层路径命中', () => {
  assert.equal(isInsideRoot('/ws/root', '/ws/root/a.txt'), true)
  assert.equal(isInsideRoot('/ws/root', '/ws/root/agents/bot/x.html'), true)
})

test('isInsideRoot：相邻目录被拒（startsWith 漏洞回归）', () => {
  // /ws/root-other 与 /ws/root 前缀相同但不是子路径
  assert.equal(isInsideRoot('/ws/root', '/ws/root-other/a.txt'), false)
  assert.equal(isInsideRoot('/ws/root', '/ws/roo2/a.txt'), false)
})

test('isInsideRoot：父目录逃逸被拒（含逐段 ..）', () => {
  assert.equal(isInsideRoot('/ws/root', '/ws/a.txt'), false)
  assert.equal(isInsideRoot('/ws/root', '/'), false)
  assert.equal(isInsideRoot('/ws/root', '/ws/root/../../etc/passwd'), false)
})

test('isInsideRoot：文件名以 .. 开头不误拒（合法 ..notes.txt）', () => {
  assert.equal(isInsideRoot('/ws/root', '/ws/root/..notes.txt'), true)
  assert.equal(isInsideRoot('/ws/root', '/ws/root/..drafts/a.md'), true)
})

test('isInsideRoot：根本身（目录）与空值被拒', () => {
  assert.equal(isInsideRoot('/ws/root', '/ws/root'), false)
  assert.equal(isInsideRoot(null, '/ws/root/a'), false)
  assert.equal(isInsideRoot('/ws/root', null), false)
})

test('classifyDeliveryTarget：无上下文 / 统一实体 → DM', () => {
  assert.equal(classifyDeliveryTarget({ conversationId: null, botId: 'chief', conversations: [] }), 'dm')
  assert.equal(classifyDeliveryTarget({ conversationId: 'chief', botId: 'chief', conversations: [] }), 'dm')
})

test('classifyDeliveryTarget：存在的会话实体（含单成员群）→ room', () => {
  const conversations = [
    { id: 'g1', memberBotIds: ['a', 'b'] },
    { id: 'g2', memberBotIds: ['a'] }, // 单成员群：v3 会话身份固定，仍是群
  ]
  assert.equal(classifyDeliveryTarget({ conversationId: 'g1', botId: 'chief', conversations }), 'room')
  assert.equal(classifyDeliveryTarget({ conversationId: 'g2', botId: 'chief', conversations }), 'room')
})

test('classifyDeliveryTarget：群已删除 → rejected（不落私聊回归）', () => {
  assert.equal(classifyDeliveryTarget({ conversationId: 'deleted-1', botId: 'chief', conversations: [{ id: 'g1', memberBotIds: ['a'] }] }), 'rejected')
})
