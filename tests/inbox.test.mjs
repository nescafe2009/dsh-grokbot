import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanInbox, enqueueJob, claimJob, completeJob, failJob } from '../src/inbox.mjs'
import { parseCrew, routeJob } from '../src/crew.mjs'

async function withInbox(fn) {
  const root = await mkdtemp(join(tmpdir(), 'grokbot-test-'))
  try {
    await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('enqueueJob 写入 queue.jsonl 与 job 目录，scanInbox 能发现它', async () => {
  await withInbox(async (root) => {
    const job = await enqueueJob(root, { toBot: 'chief', text: '你好' })
    assert.equal(job.toBot, 'chief')
    const queue = await readFile(join(root, 'queue.jsonl'), 'utf8')
    assert.ok(queue.includes(job.jobId))
    const jobs = await scanInbox(root)
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].jobId, job.jobId)
    assert.equal(jobs[0].text, '你好')
    assert.equal(jobs[0].toBot, 'chief')
  })
})

test('已回复的任务不会再被 scanInbox 扫到', async () => {
  await withInbox(async (root) => {
    const job = await enqueueJob(root, { text: '任务A' })
    await claimJob(job, 'chief')
    await completeJob(job, 'chief', '完成了')
    const reply = await readFile(join(job.dir, 'reply.md'), 'utf8')
    assert.equal(reply.trim(), '完成了')
    const jobs = await scanInbox(root)
    assert.equal(jobs.length, 0)
  })
})

test('失败任务写入失败状态与错误回复', async () => {
  await withInbox(async (root) => {
    const job = await enqueueJob(root, { text: '任务B' })
    await failJob(job, 'chief', '超时')
    const reply = await readFile(join(job.dir, 'reply.md'), 'utf8')
    assert.ok(reply.includes('超时'))
    const jobs = await scanInbox(root)
    assert.equal(jobs.length, 0)
  })
})

test('prompt.md 优先于 queue 行内 text', async () => {
  await withInbox(async (root) => {
    const job = await enqueueJob(root, { text: '短文本' })
    await writeFile(join(job.dir, 'prompt.md'), '这是完整提示词', 'utf8')
    const jobs = await scanInbox(root)
    assert.equal(jobs[0].text, '这是完整提示词')
  })
})

test('损坏的 queue 行不会导致扫描崩溃', async () => {
  await withInbox(async (root) => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'queue.jsonl'), 'not-json\n\n{"jobId":"ok1","text":"hi"}\n', 'utf8')
    await mkdir(join(root, 'ok1'), { recursive: true })
    const jobs = await scanInbox(root)
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].jobId, 'ok1')
  })
})

test('parseCrew 校验与默认值', () => {
  const crew = parseCrew(JSON.stringify({
    routing: { default: 'a' },
    bots: [{ id: 'a', name: '甲' }, { id: 'b' }],
  }))
  assert.equal(crew.bots.length, 2)
  assert.equal(crew.bots[1].avatar, '🤖')
  assert.throws(() => parseCrew(JSON.stringify({ bots: [{ id: 'a' }, { id: 'a' }] })))
  assert.throws(() => parseCrew(JSON.stringify({ routing: { default: 'zzz' }, bots: [{ id: 'a' }] })))
})

test('routeJob：指定 bot 优先，否则走 default', () => {
  const crew = parseCrew(JSON.stringify({
    routing: { default: 'b' },
    bots: [{ id: 'a' }, { id: 'b' }],
  }))
  assert.equal(routeJob(crew, { toBot: 'a' }).id, 'a')
  assert.equal(routeJob(crew, {}).id, 'b')
  assert.equal(routeJob(crew, { toBot: 'ghost' }).id, 'b')
})

test('状态文件在完成后可读回', async () => {
  await withInbox(async (root) => {
    const job = await enqueueJob(root, { text: 'x' })
    await claimJob(job, 'chief')
    await completeJob(job, 'chief', 'ok')
    const status = JSON.parse(await readFile(join(job.dir, 'status.json'), 'utf8'))
    assert.equal(status.status, 'replied')
    assert.equal(status.botId, 'chief')
    await stat(join(job.dir, 'reply.md'))
  })
})
