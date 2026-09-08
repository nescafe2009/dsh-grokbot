#!/usr/bin/env node
// 构建并在本机起服务：隔离浏览器 UI 证据页（真实组件 + mock fetch，不触真实会话）。
// 用法：node tests/browser-ui-fixture/run.mjs        # 构建并常驻（Ctrl-C 退出）
import { build } from 'tsdown'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { symlink, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')

// react/react-dom 来自组件测试环境 /tmp/react-test-env（不进仓库依赖；R3 收口版本时再定）。
// rolldown 从导入文件逐级向上解析 node_modules：src/client 需要根级可见，harness 需要 fixture 级可见
const REACT_ENV = '/tmp/react-test-env/node_modules'
for (const target of [join(repoRoot, 'node_modules'), join(here, 'node_modules')]) {
  await mkdir(target, { recursive: true })
  for (const pkg of ['react', 'react-dom']) {
    await symlink(`${REACT_ENV}/${pkg}`, join(target, pkg), 'dir').catch(() => undefined) // 已存在则跳过
  }
}
await build({
  config: false,
  entry: [join(here, 'harness.tsx')],
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outDir: here,
  outputOptions: { entryFileNames: 'harness.page.js' },
  clean: false,
  loader: { '.svg': 'text' },
  external: [],
})

const js = await readFile(join(here, 'harness.page.js'), 'utf8')
const html = `<!doctype html><html><head><meta charset="utf-8"><title>browser-ui-harness</title></head>
<body style="margin:12px"><div id="root"></div><script>${js.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(html)
})
await new Promise((r) => server.listen(8792, '127.0.0.1', r))
console.log(JSON.stringify({ event: 'browser-ui-harness-ready', url: 'http://127.0.0.1:8792/' }))
process.on('SIGINT', () => { server.closeAllConnections?.(); server.close(() => process.exit(0)) })
