#!/bin/bash
# 构建组件测试 bundle（真实组件代码 + react 测试环境）
set -euo pipefail
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
CTB=/tmp/ctb
RTE=/tmp/react-test-env

# 1. 安装 react 测试依赖（如果不存在）
if [ ! -f "$RTE/node_modules/react/package.json" ]; then
  mkdir -p "$RTE"
  npm install --prefix "$RTE" react react-dom happy-dom
fi

# 2. 构建 ESM bundle
cd "$PROJ"
npx tsdown src/client/test-entry.ts --format esm --platform node --outDir "$CTB" --external react,react-dom,react/jsx-runtime 2>&1 | grep -q "Build complete"

# 3. react symlink
mkdir -p "$CTB/node_modules"
ln -sfn "$RTE/node_modules/react" "$CTB/node_modules/react"
ln -sfn "$RTE/node_modules/react-dom" "$CTB/node_modules/react-dom"
ln -sfn "$RTE/node_modules/scheduler" "$CTB/node_modules/scheduler"

echo "component test bundle ready at $CTB"
