import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.mjs'],
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    outDir: 'lib',
    clean: true,
    external: [/@deepseek-ai\//],
  },
  {
    name: 'dsh-grokbot/client',
    entry: { client: 'src/client/index.tsx' },
    // avatars.ts 通过 import 自动打包进 client bundle
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    external: [/@deepseek-ai\/dsh-client-/, 'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      // jsx-runtime 必须外部化（由宿主 loader 静态模块提供，与 @deepseek-ai 自带插件同形态）——
      // 否则干净环境构建会把 react/jsx-runtime 的 CJS 副本打进包（模块级 process.env 切换，
      // 渲染器无 process → "process is not defined" 整个插件加载失败）
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-grokbot", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
