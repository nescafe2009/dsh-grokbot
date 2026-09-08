#!/usr/bin/env node
// R3-A：独立 profile 无模型验收——实际 tgz 加载、默认端点关闭、停用即恢复（rm 隔离 DSH_HOME）。
//
// 隔离边界：DSH_HOME 指向临时目录（profiles/storages/sessions/settings 全在其中，不触用户
// ~/.dsh）；共享 bundles 树以只读符号链接复用（本脚本不向其写入）；端口 8794 独立；
// 未配置任何 llm provider（无模型验收），不读不复制凭据。
//
// 用法：node tests/package-build/r3-accept.mjs <path-to-tgz>
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const TGZ = resolve(process.argv[2] ?? '')
if (!TGZ.endsWith('.tgz')) { console.error('usage: r3-accept.mjs <path-to-tgz>'); process.exit(2) }

const DSH_BIN = '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js'
const SHARED_MODULES = `${process.env.HOME}/.dsh/profiles/node_modules`
const PORT = 8794
const R3HOME = await mkdtemp(join(tmpdir(), 'dsh-r3home-'))

const evidence = { tgz: TGZ, r3home: R3HOME, port: PORT, steps: [] }
const step = (name, ok, detail = '') => {
  evidence.steps.push({ name, ok, detail: String(detail).slice(0, 300) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ''}`)
  if (!ok) process.exitCode = 1
}

// 1. 构造隔离 profile：bundles = base + web-app + grokbot（与用户 web profile 同构，依赖改为解包实际 tgz）
const profDir = join(R3HOME, 'profiles', 'r3accept')
await mkdir(join(profDir, 'node_modules'), { recursive: true })
await writeFile(join(profDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-r3accept',
  private: true,
  dependencies: { 'dsh-grokbot': `file:${TGZ}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-grokbot'] } },
}, null, 2))
await writeFile(join(profDir, 'cordis.yml'), '[]\n')
await writeFile(join(profDir, 'cordis.patch.yml'), '[]\n')
await writeFile(join(profDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
// 实际 tgz 解包进 profile node_modules（等价 plugin install 的产物形态，不跑 pnpm——不写共享树）
execFileSync('tar', ['-xzf', TGZ, '-C', join(profDir, 'node_modules')])
execFileSync('mv', [join(profDir, 'node_modules', 'package'), join(profDir, 'node_modules', 'dsh-grokbot')])
// 共享 bundles 树只读复用（符号链接，不写入）
await symlink(SHARED_MODULES, join(R3HOME, 'profiles', 'node_modules'), 'dir').catch(() => undefined)

// 2. 启动隔离 harness（DSH_HOME 隔离；无 --patch：桌面补丁层与本验收无关）
const child = spawn(process.execPath, [DSH_BIN, '--profile', 'r3accept', '--no-open', '--host', '127.0.0.1', '--port', String(PORT)], {
  env: { ...process.env, DSH_HOME: R3HOME },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let bootLog = ''
child.stdout.on('data', (d) => { bootLog += d; process.stdout.write(`[host] ${d}`) })
child.stderr.on('data', (d) => { bootLog += d; process.stderr.write(`[host-err] ${d}`) })
const childExit = new Promise((r) => child.on('exit', (code, sig) => r({ code, sig })))

try {
  // 3. 就绪等待：从启动日志解析带 token 的 URL（宿主把 launch token 放在回环 URL 里）
  let base = ''
  let exitedEarly = false
  childExit.then(() => { exitedEarly = true })
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const m = /https?:\/\/127\.0\.0\.1:\d+\/\?token=([A-Za-z0-9_-]+)/.exec(bootLog)
    if (m) { base = `http://127.0.0.1:${PORT}`; evidence.token = m[1].slice(0, 6) + '…'; break }
    if (exitedEarly) break
    await new Promise((r) => setTimeout(r, 300))
  }
  step('boot: 隔离 harness 启动并输出带 token 的回环 URL', Boolean(base), base || bootLog.slice(-400))

  if (base) {
    const token = /token=([A-Za-z0-9_-]+)/.exec(bootLog)?.[1] ?? ''
    // 4. 插件已加载 + 默认端点关闭（无需模型）
    const st = await fetch(`${base}/api/plugins/grokbot/state?token=${token}`).then((r) => r.json()).catch((e) => ({ error: String(e) }))
    step('load: 插件在隔离 profile 中加载（/state 返回 bots）', Array.isArray(st?.bots) && st.bots.length >= 1, `bots=${st?.bots?.length ?? 0}`)
    step('default-off: 测试端点默认关闭', st?.config?.testEndpoints === false, `testEndpoints=${JSON.stringify(st?.config?.testEndpoints)}`)
    const probe = await fetch(`${base}/api/plugins/grokbot/__probe/count?token=${token}`)
    step('default-off: __probe/count 不可达', probe.status === 404, `status=${probe.status}`)
  }
} finally {
  // 5. 停用 = 终止进程 + 移除隔离 DSH_HOME（产物保留语义：删除 home 即卸载；用户实例不受影响）
  child.kill('SIGTERM')
  const exited = await Promise.race([childExit, new Promise((r) => setTimeout(() => r({ code: null, sig: null }), 5000))])
  step('stop: SIGTERM 后进程退出', exited.code !== null || exited.sig !== null, JSON.stringify(exited))
  await rm(R3HOME, { recursive: true, force: true }).catch(() => undefined)
  console.log(JSON.stringify({ event: 'r3-accept-evidence', ...evidence, r3home: 'removed' }, null, 1))
}
process.on('SIGINT', () => { try { child.kill('SIGKILL') } catch { /* 已退出 */ }; rmSync(R3HOME, { recursive: true, force: true }); process.exit(130) })
