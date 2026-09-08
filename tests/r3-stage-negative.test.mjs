// stage-window 防旧结果复用回归（无宿主，纯逻辑）——Codex P2 收口。
// 复现的攻击面：预放旧 done + 不存在的截图路径 → 未开浏览器 1ms 三项全 PASS。
// 负例：旧 done（无身份）/ 错 runId / 错 phase / 错 tgzSha / 缺截图 / 空截图 / 预放 done（窗口前）
//       → 全部 FAIL（拒绝）或时机非法；超时 → BLOCKED；连续第二次（同阶段再开窗）必须重新等待。
// 正例：身份匹配 + 本轮目录实际非空截图 + 原子提交（tmp→rename）→ PASS。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeStageWindow, newRunId } from './package-build/stage-window.mjs'
import { createHash } from 'node:crypto'

const RUN_ID = newRunId()
const TGZ_SHA = createHash('sha256').update('fake-tgz').digest('hex')
const recorder = () => {
  const steps = []
  let exitCode = 0
  return {
    steps,
    exitCode: () => exitCode,
    step: (name, ok, detail = '') => {
      const state = ok === null ? 'BLOCKED' : ok ? 'PASS' : 'FAIL'
      steps.push(`${state} ${name}`)
      if (ok === false) exitCode = 1
      if (ok === null) exitCode = 2
    },
  }
}
const checks = () => [
  ['Grok 侧栏渲染', true, ''],
  ['截图留证', true, ''],
]
const atomicDone = (dir, phase, obj) => {
  const tmp = join(dir, `stage-${phase}.done.tmp`)
  writeFileSync(tmp, JSON.stringify(obj))
  renameSync(tmp, join(dir, `stage-${phase}.done`))
}

test('负例：旧 done（无身份字段）被拒绝，未开浏览器不得 PASS', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'sw-neg-'))
  try {
    // 攻击者预放旧 done + 指向不存在截图
    await writeFile(join(runDir, 'stage-a.done'), JSON.stringify({ uiRendered: true, chatOpened: true, screenshot: '/nonexistent/shot.png' }))
    const rec = recorder()
    const win = makeStageWindow({ runDir, runId: RUN_ID, tgzSha256: TGZ_SHA, step: rec.step, timeoutMs: 800, pollMs: 50 })
    // 预放的 done 在窗口开启时被清除 → 超时 BLOCKED（且没有任何 PASS）
    await win('a', 'http://x/?token=zzz', checks)
    assert.match(rec.steps.join('\n'), /BLOCKED browser\(a\): 浏览器阶段结果/)
    assert.ok(!rec.steps.some((s) => s.startsWith('PASS')), '不得出现任何 PASS')
    assert.equal(rec.exitCode(), 2)
  } finally { await rm(runDir, { recursive: true, force: true }) }
})

test('负例：错 runId / 错 phase / 错 tgzSha 各自被拒（FAIL 非零）', async () => {
  for (const [label, patch] of [
    ['错 runId', { runId: 'stale-run' }],
    ['错 phase', { phase: 'b' }],
    ['错 tgzSha', { tgzSha256: 'f'.repeat(64) }],
  ]) {
    const runDir = await mkdtemp(join(tmpdir(), 'sw-id-'))
    try {
      const shot = join(runDir, 'shot.png')
      await writeFile(shot, 'png-bytes')
      const rec = recorder()
      const win = makeStageWindow({ runDir, runId: RUN_ID, tgzSha256: TGZ_SHA, step: rec.step, timeoutMs: 3000, pollMs: 50 })
      setTimeout(() => atomicDone(runDir, 'a', { runId: RUN_ID, phase: 'a', tgzSha256: TGZ_SHA, uiRendered: true, screenshot: 'shot.png', ...patch }), 120)
      await win('a', 'http://x/?token=zzz', checks)
      assert.ok(rec.steps.some((s) => s.startsWith('FAIL browser(a): 身份校验')), `${label}: 应 FAIL 身份校验`)
      assert.ok(!rec.steps.some((s) => s.startsWith('PASS')), `${label}: 不得 PASS`)
      assert.equal(rec.exitCode(), 1)
    } finally { await rm(runDir, { recursive: true, force: true }) }
  }
})

test('负例：截图路径存在但不在本轮目录 / 空文件 → 截图步 FAIL', async () => {
  for (const [label, shotPath, bytes] of [
    ['目录外路径', (d) => join(d, '..', 'outside.png'), 'png'],
    ['本轮目录空文件', (d) => join(d, 'empty.png'), ''],
  ]) {
    const runDir = await mkdtemp(join(tmpdir(), 'sw-shot-'))
    try {
      const outside = shotPath(runDir)
      await writeFile(outside, bytes)
      const rel = outside.startsWith(runDir) ? outside.slice(runDir.length + 1) : outside
      const rec = recorder()
      const win = makeStageWindow({ runDir, runId: RUN_ID, tgzSha256: TGZ_SHA, step: rec.step, timeoutMs: 3000, pollMs: 50 })
      setTimeout(() => atomicDone(runDir, 'a', { runId: RUN_ID, phase: 'a', tgzSha256: TGZ_SHA, uiRendered: true, screenshot: rel }), 120)
      await win('a', 'http://x/?token=zzz', checks)
      assert.ok(rec.steps.some((s) => s.startsWith('PASS browser(a): Grok 侧栏渲染')), `${label}: 非截图项照常`)
      assert.ok(rec.steps.some((s) => s.startsWith('FAIL browser(a): 截图留证')), `${label}: 截图须 FAIL`)
      assert.equal(rec.exitCode(), 1)
    } finally { await rm(runDir, { recursive: true, force: true }) }
  }
})

test('正例：身份匹配 + 本轮目录实际非空截图 + 原子提交 → PASS；第二次同阶段必须重新等待', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'sw-pos-'))
  try {
    await writeFile(join(runDir, 'shot.png'), 'png-bytes-real')
    const rec = recorder()
    const win = makeStageWindow({ runDir, runId: RUN_ID, tgzSha256: TGZ_SHA, step: rec.step, timeoutMs: 3000, pollMs: 50 })
    setTimeout(() => atomicDone(runDir, 'a', { runId: RUN_ID, phase: 'a', tgzSha256: TGZ_SHA, uiRendered: true, chatOpened: true, screenshot: 'shot.png' }), 120)
    const r = await win('a', 'http://x/?token=zzz', checks)
    assert.equal(r?.uiRendered, true)
    assert.ok(rec.steps.every((s) => s.startsWith('PASS')), `全部 PASS（got: ${rec.steps.join('; ')}）`)
    assert.equal(rec.exitCode(), 0)
    // 第二次开窗：旧 done 已被清除 → 必须重新等待（短超时 → BLOCKED 非零）
    const rec2 = recorder()
    const win2 = makeStageWindow({ runDir, runId: RUN_ID, tgzSha256: TGZ_SHA, step: rec2.step, timeoutMs: 400, pollMs: 50 })
    await win2('a', 'http://x/?token=zzz', checks)
    assert.match(rec2.steps.join('\n'), /BLOCKED/)
    assert.equal(rec2.exitCode(), 2)
  } finally { await rm(runDir, { recursive: true, force: true }) }
})
