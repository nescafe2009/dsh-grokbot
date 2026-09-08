#!/usr/bin/env node
// R3-B：真实浏览器渲染前后对照（无模型）——分阶段 fixture。
//
// 阶段协议：每阶段启动自有隔离 profile（实际 tgz），把带 token 的完整 UI URL 写入本地文件
// （dist/r3/stage-?.url，不进日志）；随后轮询同目录旗标文件 stage-?.done（JSON 结果，由浏览器
// 操作方写入），超时 240s 标 BLOCKED（退出码 2）。脚本侧同时沿用已过 HTTP 断言（会话建立/
// state 200→404 / shell 引用 5→0）。全程无模型（隔离 DSH_HOME 未配置任何 llm provider）。
// 哨兵：boot#1 后在 $DSH_HOME/grokbot 写入哨兵字节，收尾校验字节不变 + crew.json 保留。
//
// 用法：node tests/package-build/r3-browser.mjs <path-to-tgz>
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, symlink, rm, readFile } from 'node:fs/promises'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { makeStageWindow, newRunId } from './stage-window.mjs'

const TGZ = resolve(process.argv[2] ?? '')
if (!TGZ.endsWith('.tgz')) { console.error('usage: r3-browser.mjs <path-to-tgz>'); process.exit(2) }
const DSH_BIN = '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js'
const SHARED_MODULES = `${process.env.HOME}/.dsh/profiles/node_modules`
const PORT = 8795
const HERE = dirname(fileURLToPath(import.meta.url))
// 每轮独立 run 目录：URL/done/截图隔离，防旧结果复用（runId+phase+tgzSha 身份绑定）
const RUN_ID = newRunId()
const OUTDIR = resolve(HERE, '..', '..', 'dist', 'r3', `run-${RUN_ID}`)
await mkdir(OUTDIR, { recursive: true })
const TGZ_SHA = createHash('sha256').update(readFileSync(resolve(TGZ))).digest('hex')

const sanitize = (s) => String(s).replace(/token=[A-Za-z0-9_-]+/g, 'token=***')
const fetchBounded = (url, opts = {}, ms = 8000) => fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }).catch(() => ({ status: 0, headers: { get: () => null }, text: async () => '', json: async () => ({}) }))

const evidence = { tgz: TGZ, port: PORT, steps: [] }
const step = (name, ok, detail = '') => {
  const state = ok === null ? 'BLOCKED' : ok ? 'PASS' : 'FAIL'
  evidence.steps.push({ name, state, detail: sanitize(String(detail)).slice(0, 220) })
  console.log(`${state} ${name}${detail ? ` — ${sanitize(String(detail)).slice(0, 180)}` : ''}`)
  if (ok === false) process.exitCode = 1
  if (ok === null) process.exitCode = 2
}

let R3HOME = null
let child = null
const waitExit = (c, ms) => Promise.race([new Promise((r) => c.on('exit', (code, sig) => r({ code, sig }))), new Promise((r) => setTimeout(() => r(null), ms))])
const cleanup = async () => {
  if (child?.exitCode === null && !child?.killed) {
    child.kill('SIGTERM')
    if (!await waitExit(child, 4000)) child.kill('SIGKILL')
    await waitExit(child, 2000)
  }
  child = null
  if (R3HOME) { await rm(R3HOME, { recursive: true, force: true }).catch(() => undefined); R3HOME = null }
}
process.on('SIGINT', () => { void cleanup().finally(() => process.exit(130)) })
process.on('SIGTERM', () => { void cleanup().finally(() => process.exit(143)) })

const bootAndReady = async () => {
  child = spawn(process.execPath, [DSH_BIN, '--profile', 'r3accept', '--no-open', '--host', '127.0.0.1', '--port', String(PORT)], {
    env: { ...process.env, DSH_HOME: R3HOME }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let bootLog = ''
  child.stdout.on('data', (d) => { bootLog += d })
  child.stderr.on('data', (d) => { bootLog += d })
  let early = null
  child.on('exit', (code, sig) => { early ??= { code, sig } })
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const token = /token=([A-Za-z0-9_-]+)/.exec(bootLog)?.[1]
    if (token) return { token }
    if (early) return { token: null }
    await new Promise((r) => setTimeout(r, 300))
  }
  return { token: null }
}
const stopChild = async (label) => {
  child.kill('SIGTERM')
  const ex = await waitExit(child, 5000)
  if (!ex) { child.kill('SIGKILL'); await waitExit(child, 2000) }
  step(`stop(${label}): 进程退出确认`, Boolean(ex), JSON.stringify(ex ?? 'SIGKILL'))
  child = null
}
const session = async (base, token) => {
  const r = await fetchBounded(`${base}/?token=${token}`, { redirect: 'manual' })
  const cookie = r.headers?.get?.('set-cookie')?.split(';')[0] ?? null
  return cookie && r.status === 303 ? cookie : null
}
const stageWindow = makeStageWindow({ runDir: OUTDIR, runId: RUN_ID, tgzSha256: TGZ_SHA, step, timeoutMs: Number(process.env.R3_STAGE_TIMEOUT_MS) || 240_000 })

try {
  R3HOME = await mkdtemp(join(tmpdir(), 'dsh-r3browser-'))
  const marker = join(R3HOME, 'marker')
  writeFileSync(marker, '')
  const profDir = join(R3HOME, 'profiles', 'r3accept')
  await mkdir(join(profDir, 'node_modules'), { recursive: true })
  const profileJson = (withGrokbot) => JSON.stringify(withGrokbot ? {
    name: 'dsh-profile-r3accept', private: true,
    dependencies: { 'dsh-grokbot': `file:${TGZ}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-grokbot'] } },
  } : {
    name: 'dsh-profile-r3accept', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }, null, 2)
  await writeFile(join(profDir, 'package.json'), profileJson(true))
  await writeFile(join(profDir, 'cordis.yml'), '[]\n')
  await writeFile(join(profDir, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(profDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  execFileSync('tar', ['-xzf', TGZ, '-C', join(profDir, 'node_modules')])
  execFileSync('mv', [join(profDir, 'node_modules', 'package'), join(profDir, 'node_modules', 'dsh-grokbot')])
  await symlink(SHARED_MODULES, join(R3HOME, 'profiles', 'node_modules'), 'dir').catch(() => undefined)
  const base = `http://127.0.0.1:${PORT}`

  // ===== 阶段 A：插件在载（无模型）——浏览器检查 Grok 侧栏/聊天入口实际渲染 =====
  const a = await bootAndReady()
  step('boot#A: 隔离 harness 启动', Boolean(a.token))
  const cookieA = a.token ? await session(base, a.token) : null
  step('boot#A: 临时认证会话', Boolean(cookieA))
  if (cookieA) {
    const htmlA = await fetchBounded(`${base}/`, { headers: { cookie: cookieA } }).then((r) => r.text())
    const refsA = (htmlA.match(/grokbot/g) ?? []).length
    step('http#A: shell 引用 grokbot（沿用）', refsA >= 1, `引用数=${refsA}`)
    const stA = await fetchBounded(`${base}/api/plugins/grokbot/state`, { headers: { cookie: cookieA } })
    step('http#A: state 200（沿用）', stA.status === 200, `status=${stA.status}`)
  }
  // 哨兵（插件 init 已建数据目录后写入；收尾校验字节不变——无秘密产物内容）
  const sentinelBytes = `r3-sentinel-${Date.now()}\n`
  const sentinelPath = join(R3HOME, 'grokbot', 'r3-sentinel.txt')
  const crewOk = await readFile(join(R3HOME, 'grokbot', 'crew.json'), 'utf8').then(() => true).catch(() => false)
  if (crewOk) writeFileSync(sentinelPath, sentinelBytes)
  step('sentinel: 哨兵写入数据目录', crewOk, crewOk ? sentinelPath.replace(R3HOME, '$DSH_HOME') : 'crew.json 未生成，无法写哨兵')

  await stageWindow('a', `${base}/?token=${a.token}`, (r) => [
    ['Grok 侧栏/机器人入口渲染', r.uiRendered === true, r.uiDetail ?? ''],
    ['聊天视图可打开（无模型不无限加载）', r.chatOpened === true, r.chatDetail ?? ''],
    ['截图留证', typeof r.screenshot === 'string' && r.screenshot.length > 0, r.screenshot ?? ''],
  ])
  await stopChild('boot#A')

  // ===== 阶段 B：移除插件重启——原生宿主可操作，Grok 节点/样式消失 =====
  await writeFile(join(profDir, 'package.json'), profileJson(false))
  await rm(join(profDir, 'node_modules', 'dsh-grokbot'), { recursive: true, force: true })
  const b = await bootAndReady()
  step('boot#B: 移除插件后宿主启动', Boolean(b.token))
  const cookieB = b.token ? await session(base, b.token) : null
  step('boot#B: 临时认证会话', Boolean(cookieB))
  if (cookieB) {
    const rootB = await fetchBounded(`${base}/`, { headers: { cookie: cookieB } })
    const htmlB = await rootB.text?.() ?? ''
    step('http#B: 原生根路由 200 + shell 零 grokbot 引用（沿用）', rootB.status === 200 && (htmlB.match(/grokbot/g) ?? []).length === 0, `status=${rootB.status}, 引用数=${(htmlB.match(/grokbot/g) ?? []).length}`)
    const goneB = await fetchBounded(`${base}/api/plugins/grokbot/state`, { headers: { cookie: cookieB } })
    step('http#B: 插件路由 404（沿用）', goneB.status === 404, `status=${goneB.status}`)
  }
  await stageWindow('b', `${base}/?token=${b.token}`, (r) => [
    ['原生宿主可操作', r.nativeOperable === true, r.nativeDetail ?? ''],
    ['Grok 节点/样式消失', r.grokGone === true, r.goneDetail ?? ''],
    ['截图留证', typeof r.screenshot === 'string' && r.screenshot.length > 0, r.screenshot ?? ''],
  ])
  await stopChild('boot#B')

  // ===== 哨兵字节与数据保留 =====
  const sentinelKept = existsSync(sentinelPath) && readFileSync(sentinelPath, 'utf8') === sentinelBytes
  step('retain: 哨兵字节不变（无秘密产物保留）', sentinelKept)
  const crewKept = await readFile(join(R3HOME, 'grokbot', 'crew.json'), 'utf8').then(() => true).catch(() => false)
  step('retain: crew.json 保留', crewKept)
  const diff = execFileSync('find', ['-H', SHARED_MODULES, '-newer', marker, '-not', '-path', '*/node_modules/.pnpm/*lock*'], { encoding: 'utf8' }).trim()
  step('shared: 共享树运行期间零变动（find -newer）', diff === '', diff === '' ? '无任何新增/修改' : diff.split('\n').slice(0, 3).join('; '))
} finally {
  await cleanup()
  // URL 文件含 token：run 结束清理，不留 token；done/截图/证据保留于本轮 run 目录
  for (const f of ['stage-a.url', 'stage-b.url']) { try { rmSync(join(OUTDIR, f)) } catch { /* 已不存在 */ } }
  writeFileSync(join(OUTDIR, 'r3-browser-evidence.json'), JSON.stringify({ ...evidence, runId: RUN_ID, tgzSha256: TGZ_SHA, r3home: 'removed' }, null, 1))
  console.log(JSON.stringify({ event: 'r3-browser-evidence', runDir: OUTDIR, steps: evidence.steps.map((s) => `${s.state} ${s.name}`), exitCode: process.exitCode ?? 0 }))
}
