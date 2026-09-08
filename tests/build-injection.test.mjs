// npm run build 故障注入回归——三种失败场景下：非零退出、无 deployed 实际输出、
// 旧 lib 原地保留（字节不变）、无 lib.old/lib.tmp 残留。沙箱副本运行，不动真实仓库 lib/。
// 场景来自 Codex R3-A 复核：exit42、exit0 但缺 index.mjs、exit0 但缺 client.js。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const buildScript = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8')).scripts.build

async function makeSandbox() {
  const dir = await mkdtemp(join(tmpdir(), 'build-inj-'))
  const proj = join(dir, 'proj')
  await mkdir(join(proj, 'lib'), { recursive: true })
  await writeFile(join(proj, 'lib', 'index.mjs'), 'OLD index sentinel')
  await writeFile(join(proj, 'lib', 'client.js'), 'OLD client sentinel')
  await writeFile(join(proj, 'tsdown.config.ts'), 'export default {}')
  await writeFile(join(proj, 'package.json'), JSON.stringify({ name: 'sbx', private: true, scripts: { build: buildScript } }))
  const bin = join(dir, 'bin')
  await mkdir(bin)
  return { dir, proj, bin, libHash: async () => {
    const a = await readFile(join(proj, 'lib', 'index.mjs'))
    const b = await readFile(join(proj, 'lib', 'client.js'))
    return createHash('sha256').update(a).update(b).digest('hex')
  } }
}

// npx 桩：解析 --outDir 参数，按场景产出文件并退出
async function stubNpx(sandbox, { files = [], code = 0 }) {
  const stub = join(sandbox.bin, 'npx')
  const mk = files.map((f) => `echo stub > "$OUT/$f"`).join('\n')
  await writeFile(stub, `#!/bin/bash
OUT=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--outDir" ]; then OUT="$a"; break; fi
  prev="$a"
done
mkdir -p "$OUT"
${mk}
exit ${code}
`, { mode: 0o755 })
}

async function runBuild(sandbox) {
  const r = spawnSync('npm', ['run', 'build'], { cwd: sandbox.proj, env: { ...process.env, PATH: `${sandbox.bin}:${process.env.PATH}` }, encoding: 'utf8' })
  return r
}

test('注入回归：exit 42 / 缺 index / 缺 client 三场景均不误报成功', async () => {
  const scenarios = [
    { name: 'npx exit 42', files: [], code: 42 },
    { name: 'exit 0 但缺 index.mjs', files: ['client.js'], code: 0 },
    { name: 'exit 0 但缺 client.js', files: ['index.mjs'], code: 0 },
  ]
  for (const sc of scenarios) {
    const sandbox = await makeSandbox()
    try {
      await stubNpx(sandbox, sc)
      const before = await sandbox.libHash()
      const r = await runBuild(sandbox)
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
      // 1) 非零退出
      assert.notEqual(r.status, 0, `${sc.name}: 必须非零退出（got ${r.status}）`)
      // 2) 无 deployed 实际输出（npm 回显命令文本的行除外）
      const deployedLines = out.split('\n').filter((l) => l.includes('deployed') && !l.trimStart().startsWith('>') && !l.includes('npm run build'))
      assert.equal(deployedLines.length, 0, `${sc.name}: 不得输出 deployed（${deployedLines.join('|')}）`)
      // 3) 旧 lib 原地保留（字节不变）
      assert.equal(await sandbox.libHash(), before, `${sc.name}: 旧 lib 必须保留且内容不变`)
      // 4) 无 lib.old / lib.tmp 残留
      const leftovers = (await readdir(sandbox.proj)).filter((n) => n.startsWith('lib.') || n.startsWith('grokbot-lib'))
      assert.deepEqual(leftovers, [], `${sc.name}: 无残留（${leftovers}）`)
    } finally {
      await rm(sandbox.dir, { recursive: true, force: true })
    }
  }
})
