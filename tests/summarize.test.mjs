import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeTurn } from '../src/index.mjs'

const ev = (seq, type, data) => ({ seq, type, data })

test('summarizeTurn：assistant/message 优先', () => {
  const outcome = summarizeTurn([
    ev(1, 'turn/start', {}),
    ev(2, 'assistant/chunk', { step: 0, chunk: { choices: [{ delta: { content: '部分' } }] } }),
    ev(3, 'assistant/message', { step: 0, message: { content: [{ type: 'text', text: '完整回复' }] } }),
    ev(4, 'turn/end', { stopReason: 'completed' }),
  ], 1)
  assert.equal(outcome.text, '完整回复')
  assert.equal(outcome.stopReason, 'completed')
})

test('summarizeTurn：工具调用后最后一个 step 的文本胜出', () => {
  const outcome = summarizeTurn([
    ev(1, 'step/start', { step: 0 }),
    ev(2, 'assistant/message', { step: 0, message: { content: [{ type: 'text', text: '我先看看目录' }] } }),
    ev(3, 'tool/call', { step: 0 }),
    ev(4, 'tool/result', { step: 0 }),
    ev(5, 'step/end', { step: 0 }),
    ev(6, 'step/start', { step: 1 }),
    ev(7, 'assistant/chunk', { step: 1, chunk: { choices: [{ delta: { content: '工作区里有 3 个文件' } }] } }),
    ev(8, 'step/end', { step: 1 }),
    ev(9, 'turn/end', { stopReason: 'completed' }),
  ], 1)
  assert.equal(outcome.text, '工作区里有 3 个文件')
})

test('summarizeTurn：无 message 时回退到 chunk 增量拼接（取最后一个非空 step）', () => {
  const outcome = summarizeTurn([
    ev(1, 'step/start', { step: 0 }),
    ev(2, 'assistant/chunk', { step: 0, chunk: { choices: [{ delta: { content: '你' } }] } }),
    ev(3, 'assistant/chunk', { step: 0, chunk: { choices: [{ delta: { content: '好' } }] } }),
    ev(4, 'tool/call', { step: 0 }),
    ev(5, 'tool/result', { step: 0 }),
    ev(6, 'step/end', { step: 0 }),
    ev(7, 'step/start', { step: 1 }),
    ev(8, 'assistant/chunk', { step: 1, chunk: { delta: { text: '最终' } } }),
    ev(9, 'assistant/chunk', { step: 1, chunk: { delta: { text: '答案' } } }),
    ev(10, 'step/end', { step: 1 }),
    ev(11, 'turn/end', { stopReason: 'completed' }),
  ], 1)
  assert.equal(outcome.text, '最终答案')
})

test('summarizeTurn：firstSeq 之前的事件被忽略', () => {
  const outcome = summarizeTurn([
    ev(1, 'assistant/message', { message: { content: [{ type: 'text', text: '旧回合' }] } }),
    ev(5, 'assistant/message', { message: { content: [{ type: 'text', text: '新回合' }] } }),
  ], 3)
  assert.equal(outcome.text, '新回合')
})

test('summarizeTurn：空事件返回空文本与 completed', () => {
  const outcome = summarizeTurn([], 0)
  assert.equal(outcome.text, '')
  assert.equal(outcome.stopReason, 'completed')
})
