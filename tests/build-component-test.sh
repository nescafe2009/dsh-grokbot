#!/bin/bash
# 构建组件测试 bundle（真实组件代码 + react 测试环境，独立输出目录）
set -euo pipefail
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
CTB=/tmp/ctb-$$-$(date +%s) # 每次独立目录（不用共享 /tmp/ctb）
RTE=/tmp/react-test-env

# 1. 安装 react 测试依赖（明确版本）——与实测环境一致：react 19.2.8 / happy-dom 20.14.0。
#    已有环境必须核验版本匹配（不匹配即失败，不静默沿用）
RTE_REACT=19.2.8 RTE_REACT_DOM=19.2.8 RTE_HAPPY_DOM=20.14.0
if [ ! -f "$RTE/node_modules/react/package.json" ]; then
  mkdir -p "$RTE"
  echo '{"name":"react-test-env","private":true}' > "$RTE/package.json"
  npm install --prefix "$RTE" react@19.2.8 react-dom@19.2.8 happy-dom@20.14.0 2>&1 | tail -1
fi
ver() { node -e "try{console.log(require('$1/package.json').version)}catch{console.log('missing')}"; }
[ "$(ver "$RTE/node_modules/react")" = "$RTE_REACT" ] || { echo "react 版本不符: $(ver "$RTE/node_modules/react") ≠ $RTE_REACT"; exit 1; }
[ "$(ver "$RTE/node_modules/react-dom")" = "$RTE_REACT_DOM" ] || { echo "react-dom 版本不符: $(ver "$RTE/node_modules/react-dom") ≠ $RTE_REACT_DOM"; exit 1; }
[ "$(ver "$RTE/node_modules/happy-dom")" = "$RTE_HAPPY_DOM" ] || { echo "happy-dom 版本不符: $(ver "$RTE/node_modules/happy-dom") ≠ $RTE_HAPPY_DOM"; exit 1; }

# 2. 构建 ESM bundle（不用 pipe——保留完整退出码）。
# external 必须逐个传参：逗号串会被当成单个包名，react 被打进包内——
# 一旦根 node_modules 可解析 react（如 browser fixture 建过链接），与测试环境的
# react 形成双实例，23 组件全部 Invalid hook call。
cd "$PROJ"
npx tsdown src/client/test-entry.ts --format esm --platform node --outDir "$CTB" \
  --external react \
  --external react-dom \
  --external react/jsx-runtime \
  > /dev/null 2>&1
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
