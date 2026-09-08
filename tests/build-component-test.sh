#!/bin/bash
# 构建组件测试 bundle（真实组件代码 + react 测试环境，独立输出目录）
set -euo pipefail
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
CTB=/tmp/ctb-$$-$(date +%s) # 每次独立目录（不用共享 /tmp/ctb）
RTE=/tmp/react-test-env

# 1. 安装 react 测试依赖（明确版本，如果不存在）
if [ ! -f "$RTE/node_modules/react/package.json" ]; then
  mkdir -p "$RTE"
  echo '{"name":"react-test-env","private":true}' > "$RTE/package.json"
  npm install --prefix "$RTE" react@19.1.0 react-dom@19.1.0 happy-dom 2>&1 | tail -1
fi

# 2. 构建 ESM bundle（不用 pipe——保留完整退出码）
cd "$PROJ"
npx tsdown src/client/test-entry.ts --format esm --platform node --outDir "$CTB" --external react,react-dom,react/jsx-runtime > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "BUILD FAILED"
  rm -rf "$CTB"
  exit 1
fi

# 3. react symlink
mkdir -p "$CTB/node_modules"
ln -sfn "$RTE/node_modules/react" "$CTB/node_modules/react"
ln -sfn "$RTE/node_modules/react-dom" "$CTB/node_modules/react-dom"
ln -sfn "$RTE/node_modules/scheduler" "$CTB/node_modules/scheduler"

# 4. 输出路径写入环境文件（spec.mjs 读取）
echo "export const CTB_DIR = '$CTB';" > tests/ctb-path.mjs

echo "component test bundle ready at $CTB"
