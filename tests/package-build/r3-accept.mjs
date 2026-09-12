#!/usr/bin/env node
// R3-A：独立 profile 无模型验收——实际 tgz 加载、默认端点关闭、真卸载复验。
//
// 证据原则（按 Codex 复核要求）：
//  - 会话证据：`/?token=` 是 303+Set-Cookie 会话交换——先建立临时认证会话（cookie），
//    再断言。插件路由用「会话认证 + 200/404」区分在载/已卸载（401 只是认证失败，不作卸载证据）。
//  - 加载清单/UI 挂载样式：宿主 shell HTML 中 grokbot 引用数（boot#1 ≥1，boot#2 =0）。
//  - 共享树未写入：以 mtime 哨兵（find -newer）证明运行期间零文件变动（非顶层 readdir 比对）。
//  - 进程收尾：stopChild 校验 exit 确认后才进入下一步/清理；信号处理启动即注册；全部有界。
//  - token/cookie 不回显：日志与证据一律消毒；无法建立会话时该步标 BLOCKED 且进程退出码 2。
//
// 用法：node tests/package-build/r3-accept.mjs <path-to-tgz>
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, symlink, rm, readFile, readdir } from 'node:fs/promises'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TGZ = resolve(process.argv[2] ?? '')
if (!TGZ.endsWith('.tgz')) { console.error('usage: r3-accept.mjs <path-to-tgz>'); process.exit(2) }
const DSH_BIN = process.env.DSH_TEST_BIN || '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js'
const SHARED_MODULES = process.env.DSH_TEST_MODULES || `${process.env.HOME}/.dsh/profiles/node_modules`
const PORT = 8794
const sanitize = (s) => String(s).replace(/token=[A-Za-z0-9_-]+/g, 'token=***')
const fetchBounded = (url, opts = {}, ms = 8000) => fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }).catch((e) => ({ status: 0, error: String(e), headers: { get: () => null }, text: async () => '' }))

const evidence = { tgz: TGZ, port: PORT, steps: [] }
const step = (name, ok, detail = '') => {
  const state = ok === null ? 'BLOCKED' : ok ? 'PASS' : 'FAIL'
  evidence.steps.push({ name, state, detail: sanitize(String(detail)).slice(0, 200) })
  console.log(`${state} ${name}${detail ? ` — ${sanitize(String(detail)).slice(0, 160)}` : ''}`)
  if (ok === false) process.exitCode = 1
  if (ok === null) process.exitCode = 2
}

// ---- 信号处理（启动即注册）与有界清理 ----
let R3HOME = null
let child = null
const waitExit = (c, ms) => c.exitCode !== null || c.signalCode !== null ? Promise.resolve({code:c.exitCode,sig:c.signalCode}) : Promise.race([new Promise((r) => c.on('exit', (code, sig) => r({ code, sig }))), new Promise((r) => setTimeout(() => r(null), ms))])
const cleanup = async () => {
  if (child?.exitCode === null && !child?.killed) {
    child.kill('SIGTERM')
    const ex = await waitExit(child, 4000)
    if (!ex) child.kill('SIGKILL')
    if (!await waitExit(child, 2000)) child.kill('SIGKILL')
  }
  child = null
  if (R3HOME) { await rm(R3HOME, { recursive: true, force: true }).catch(() => undefined); R3HOME = null }
}
process.on('SIGINT', () => { void cleanup().finally(() => process.exit(130)) })
process.on('SIGTERM', () => { void cleanup().finally(() => process.exit(143)) })

const bootAndReady = async () => {
  child = spawn(process.execPath, ['--expose-internals', DSH_BIN, '--profile', 'r3accept', '--no-open', '--host', '127.0.0.1', '--port', String(PORT)], {
    env: { ...process.env, DSH_HOME: R3HOME },
    stdio: ['ignore', 'pipe', 'pipe'],
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
    if (early) return { token: null, tail: sanitize(bootLog.slice(-1800)) }
    await new Promise((r) => setTimeout(r, 300))
  }
  return { token: null, tail: sanitize(bootLog.slice(-1800)) }
}
const stopChild = async (label) => {
  child.kill('SIGTERM')
  const ex = await waitExit(child, 5000)
  if (!ex) { child.kill('SIGKILL'); await waitExit(child, 2000) }
  step(`stop(${label}): 进程退出确认`, Boolean(ex), JSON.stringify(ex ?? { killed: 'SIGKILL 强杀' }))
  child = null
}
// 临时认证会话：/?token= 303 → set-cookie（cookie 不回显）
const establishSession = async (base, token) => {
  const r = await fetchBounded(`${base}/?token=${token}`, { redirect: 'manual' })
  const cookie = r.headers?.get?.('set-cookie')?.split(';')[0] ?? null
  return cookie && r.status === 303 ? cookie : null
}

try {
  R3HOME = await mkdtemp(join(tmpdir(), 'dsh-r3home-'))
  // mtime 哨兵：共享树在本次运行期间零文件变动（新增/修改均会被 -newer 捕获）
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
  // DSH 0.8.x manages its own installation fallback; never symlink the entire shared tree.
  await mkdir(join(R3HOME, 'profiles', 'node_modules'), {recursive:true})

  const base = `http://127.0.0.1:${PORT}`

  // ===== boot#1：插件在载 =====
  const first = await bootAndReady()
  if(first.tail) console.log(first.tail)
  step('boot#1: 隔离 harness 启动', Boolean(first.token), first.tail ?? '')
  const cookie1 = first.token ? await establishSession(base, first.token) : null
  step('boot#1: 临时认证会话建立（303+Set-Cookie）', Boolean(cookie1), cookie1 ? 'cookie 已取得（不回显）' : '会话建立失败')
  if (cookie1) {
    const html1 = await fetchBounded(`${base}/`, { headers: { cookie: cookie1 } }).then((r) => r.text())
    const refs1 = (html1.match(/grokbot/g) ?? []).length
    step('boot#1: UI 挂载样式——shell HTML 引用 grokbot（加载清单）', refs1 >= 1, `引用数=${refs1}`)
    const st1 = await fetchBounded(`${base}/api/plugins/grokbot/state`, { headers: { cookie: cookie1 } })
    step('boot#1: 插件 state 可用（会话认证）', st1.status === 200, `status=${st1.status}`)
    const st1j = await st1.json?.().catch(() => ({})) ?? {}
    step('default-off: 测试端点默认关闭', st1j?.config?.testEndpoints === false, `testEndpoints=${JSON.stringify(st1j?.config?.testEndpoints)}`)
    const probe1 = await fetchBounded(`${base}/api/plugins/grokbot/__probe/count?token=${first.token}`)
    step('default-off: __probe/count 不可达', probe1.status === 404, `status=${probe1.status}`)
  }
  const stateDir = join(R3HOME, 'grokbot')
  const hasCrew = await readFile(join(stateDir, 'crew.json'), 'utf8').then(() => true).catch(() => false)
  step('data: 插件数据在 $DSH_HOME/grokbot（dshHomePath）', hasCrew, hasCrew ? 'crew.json 存在' : 'crew.json 缺失')
  await stopChild('boot#1')

  // ===== 卸载：移除 bundle/依赖 + 删插件目录 → boot#2 =====
  await writeFile(join(profDir, 'package.json'), profileJson(false))
  await rm(join(profDir, 'node_modules', 'dsh-grokbot'), { recursive: true, force: true })
  const second = await bootAndReady()
  step('boot#2: 移除插件后宿主正常启动', Boolean(second.token), second.tail ?? '')
  const cookie2 = second.token ? await establishSession(base, second.token) : null
  step('boot#2: 临时认证会话建立', Boolean(cookie2), cookie2 ? 'cookie 已取得（不回显）' : '会话建立失败')
  if (cookie2) {
    const root2 = await fetchBounded(`${base}/`, { headers: { cookie: cookie2 } })
    step('boot#2: 原生 UI 完整服务（会话认证根路由 200）', root2.status === 200, `status=${root2.status}`)
    const html2 = await root2.text?.().catch(() => '') ?? ''
    const refs2 = (html2.match(/grokbot/g) ?? []).length
    step('boot#2: UI 挂载样式——shell HTML 零 grokbot 引用', refs2 === 0, `引用数=${refs2}`)
    const gone = await fetchBounded(`${base}/api/plugins/grokbot/state`, { headers: { cookie: cookie2 } })
    step('uninstall: grokbot 路由消失（会话认证 404，非认证噪音）', gone.status === 404, `status=${gone.status}`)
  }
  const crewKept = await readFile(join(stateDir, 'crew.json'), 'utf8').then(() => true).catch(() => false)
  step('retain: 卸载后数据文件保留', crewKept, 'crew.json 仍在 $DSH_HOME/grokbot')
  await stopChild('boot#2')

  // ===== 共享树零写入（mtime 哨兵，内容级证明）=====
  const diff = execFileSync('find', ['-H', SHARED_MODULES, '-newer', marker, '-not', '-path', '*/node_modules/.pnpm/*lock*'], { encoding: 'utf8' }).trim()
  step('shared: 宿主共享树运行期间零文件变动（find -newer）', diff === '', diff === '' ? '无任何新增/修改' : diff.split('\n').slice(0, 3).join('; '))
} finally {
  await cleanup()
  console.log(JSON.stringify({ event: 'r3-accept-evidence', ...evidence, r3home: 'removed' }, null, 1))
}
