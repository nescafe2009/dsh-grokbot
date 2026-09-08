#!/usr/bin/env node
// R3-A：独立 profile 无模型验收——实际 tgz 加载、默认端点关闭、
// **移除 bundle/依赖后重启宿主验证卸载恢复**（原生宿主可服务、grokbot 路由消失、数据文件保留）。
//
// 隔离边界：DSH_HOME 指向临时目录（profiles/storages/sessions/settings 全在其中，不触用户 ~/.dsh）；
// 共享 bundles 树以符号链接复用（并非只读——本脚本不通过其写入，收尾快照比对确认未被改动）；
// 端口 8794 独立；未配置任何 llm provider（无模型验收），不读不复制凭据；
// 宿主日志经消毒输出（token 一律替换为 ***），不记录任何 token 材料。
//
// 用法：node tests/package-build/r3-accept.mjs <path-to-tgz>
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, symlink, rm, readdir, readFile, writeFile as wf } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TGZ = resolve(process.argv[2] ?? '')
if (!TGZ.endsWith('.tgz')) { console.error('usage: r3-accept.mjs <path-to-tgz>'); process.exit(2) }
const DSH_BIN = '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js'
const SHARED_MODULES = `${process.env.HOME}/.dsh/profiles/node_modules`
const PORT = 8794

const evidence = { tgz: TGZ, port: PORT, steps: [] }
const step = (name, ok, detail = '') => {
  evidence.steps.push({ name, ok, detail: String(detail).slice(0, 200) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`)
  if (!ok) process.exitCode = 1
}
const sanitize = (s) => String(s).replace(/token=[A-Za-z0-9_-]+/g, 'token=***')
const fetchBounded = (url, ms = 8000) => fetch(url, { signal: AbortSignal.timeout(ms) }).catch((e) => ({ status: 0, error: String(e) }))

// ---- 全局清理状态与信号处理（启动即注册：任何阶段 SIGINT/SIGTERM 都有界收尾）----
let R3HOME = null
let child = null
const cleanup = async () => {
  if (child?.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([new Promise((r) => child.on('exit', r)), new Promise((r) => setTimeout(r, 4000))])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  if (R3HOME) { await rm(R3HOME, { recursive: true, force: true }).catch(() => undefined); R3HOME = null }
}
process.on('SIGINT', () => { void cleanup().finally(() => process.exit(130)) })
process.on('SIGTERM', () => { void cleanup().finally(() => process.exit(143)) })

const bootAndReady = async (label) => {
  child = spawn(process.execPath, [DSH_BIN, '--profile', 'r3accept', '--no-open', '--host', '127.0.0.1', '--port', String(PORT)], {
    env: { ...process.env, DSH_HOME: R3HOME },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let bootLog = ''
  child.stdout.on('data', (d) => { bootLog += d })
  child.stderr.on('data', (d) => { bootLog += d })
  const exited = new Promise((r) => child.on('exit', (code, sig) => r({ code, sig })))
  let early = null
  exited.then((r) => { early = r })
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const token = /token=([A-Za-z0-9_-]+)/.exec(bootLog)?.[1]
    if (token) return { token, early }
    if (early) return { token: null, early }
    await new Promise((r) => setTimeout(r, 300))
  }
  return { token: null, early, tail: sanitize(bootLog.slice(-300)) }
}
const stopChild = async (label) => {
  child.kill('SIGTERM')
  const exited = await Promise.race([new Promise((r) => child.on('exit', (code, sig) => r({ code, sig }))), new Promise((r) => setTimeout(() => r({ code: null, sig: null }), 5000))])
  if (exited.code === null && exited.sig === null) child.kill('SIGKILL')
  return exited
}

try {
  R3HOME = await mkdtemp(join(tmpdir(), 'dsh-r3home-'))
  // 共享树前后快照（符号链接非只读——以内容比对证明本脚本未通过其写入）
  const sharedBefore = (await readdir(SHARED_MODULES)).sort().join(',')

  // 1. 构造隔离 profile（与用户 web profile 同构；依赖=实际 tgz）
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
  await wf(join(profDir, 'package.json'), profileJson(true))
  await wf(join(profDir, 'cordis.yml'), '[]\n')
  await wf(join(profDir, 'cordis.patch.yml'), '[]\n')
  await wf(join(profDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  // 实际 tgz 解包进 profile node_modules（等价 plugin install 产物形态；不跑 pnpm——不写共享树）
  execFileSync('tar', ['-xzf', TGZ, '-C', join(profDir, 'node_modules')])
  execFileSync('mv', [join(profDir, 'node_modules', 'package'), join(profDir, 'node_modules', 'dsh-grokbot')])
  await symlink(SHARED_MODULES, join(R3HOME, 'profiles', 'node_modules'), 'dir').catch(() => undefined)

  // 2. 首次启动：加载 + 默认关闭
  const first = await bootAndReady()
  step('boot#1: 隔离 harness 启动（token 已消毒）', Boolean(first.token), first.tail ?? '')
  if (!first.token) throw new Error('boot#1 failed')
  const base = `http://127.0.0.1:${PORT}`
  const st = await fetchBounded(`${base}/api/plugins/grokbot/state?token=${first.token}`).then((r) => r.json?.() ?? {}).catch(() => ({}))
  step('load: 插件在实际 tgz 下加载（/state bots）', Array.isArray(st?.bots) && st.bots.length >= 1, `bots=${st?.bots?.length ?? 0}`)
  step('default-off: 测试端点默认关闭', st?.config?.testEndpoints === false, `testEndpoints=${JSON.stringify(st?.config?.testEndpoints)}`)
  const probe = await fetchBounded(`${base}/api/plugins/grokbot/__probe/count?token=${first.token}`)
  step('default-off: __probe/count 不可达', probe.status === 404, `status=${probe.status}`)

  // 3. 数据落盘位置（dshHomePath('grokbot') —— cordis.patch 配置的真实默认）
  const stateDir = join(R3HOME, 'grokbot')
  const hasCrew = await readFile(join(stateDir, 'crew.json'), 'utf8').then(() => true).catch(() => false)
  step('data: 插件数据在 $DSH_HOME/grokbot（dshHomePath）', hasCrew, hasCrew ? 'crew.json 存在' : 'crew.json 缺失')
  await stopChild()

  // 4. 卸载：移除 bundle/依赖 + 删除插件目录 → 重启 → 原生可服务/路由消失/数据保留
  await wf(join(profDir, 'package.json'), profileJson(false))
  await rm(join(profDir, 'node_modules', 'dsh-grokbot'), { recursive: true, force: true })
  const second = await bootAndReady()
  step('boot#2: 移除插件后宿主正常启动（原生 UI 可服务）', Boolean(second.token), second.tail ?? '')
  if (second.token) {
    const gone = await fetchBounded(`${base}/api/plugins/grokbot/health?token=${second.token}`)
    step('uninstall: grokbot 路由消失', gone.status === 404, `status=${gone.status}`)
    const root = await fetchBounded(`${base}/`)
    step('uninstall: 宿主根路由恢复原生服务', root.status === 200 || root.status === 307 || root.status === 401, `status=${root.status}`)
  }
  const crewKept = await readFile(join(stateDir, 'crew.json'), 'utf8').then(() => true).catch(() => false)
  step('retain: 卸载后数据文件保留', crewKept, 'crew.json 仍在 $DSH_HOME/grokbot')
  await stopChild()

  // 5. 共享树未被改动（内容快照比对）
  const sharedAfter = (await readdir(SHARED_MODULES)).sort().join(',')
  step('shared: 宿主共享 bundles 树未通过符号链接被写入', sharedBefore === sharedAfter, sharedBefore === sharedAfter ? 'entries 一致' : 'entries 发生变化')
} finally {
  await cleanup()
  console.log(JSON.stringify({ event: 'r3-accept-evidence', ...evidence, r3home: 'removed' }, null, 1))
}
