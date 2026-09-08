#!/bin/bash
# 构建独立效率采样 fixture（每批唯一目录，无秘密）
# 用法：./setup.sh  → 输出 FIXTURE_DIR=... 供 sample.mjs 使用
set -euo pipefail

DSH_APP_MODULES="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# 每批唯一目录（带时间戳+PID，防覆盖旧配置）
RUN_ID="$(date +%Y%m%d%H%M%S)-$$"
FIXTURE_HOME="/tmp/dsh-perf-fixture-${RUN_ID}"

echo "[setup] creating ${FIXTURE_HOME}"
mkdir -p "${FIXTURE_HOME}/sessions" "${FIXTURE_HOME}/workspace"
mkdir -p "${FIXTURE_HOME}/profiles/web/node_modules/@deepseek-ai"

# settings.yaml（模型配置——不含 key 值，apiKeyEnv 引用环境变量名）
cat > "${FIXTURE_HOME}/settings.yaml" <<'EOF'
llm-pi-ai:
  providers:
    zai:
      models:
        - id: glm-5.3
          name: GLM-5.3
          contextWindow: 1000000
          maxTokens: 131072
      apiKeyEnv: ZAI_API_KEY
agent-default-model:
  provider: zai
  model: glm-5.3
EOF

# package.json：用 node 生成合法 JSON（避免 shell 引号 heredoc 问题）
node -e "
const pkg = {
  name: 'dsh-perf-fixture-profile',
  private: true,
  dependencies: { 'dsh-grokbot': 'link:' + process.argv[1] },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-grokbot'] } }
};
require('fs').writeFileSync(process.argv[2], JSON.stringify(pkg, null, 2) + '\n');
" "${PROJECT_DIR}" "${FIXTURE_HOME}/profiles/web/package.json"

# cordis.yml（空 include——bundles 由 package.json 加载）
echo "[]" > "${FIXTURE_HOME}/profiles/web/cordis.yml"

# cordis.patch.yml（只启用执行工具，不重复注册 grokbot）
cat > "${FIXTURE_HOME}/profiles/web/cordis.patch.yml" <<'EOF'
- id: tool-bash
  disabled: false
- id: tool-fs
  disabled: false
- id: compaction-basic
  disabled: false
- id: tool-jobs
  disabled: false
EOF

# node_modules：DSH Desktop.app 的包（只读 link）
for pkg in "${DSH_APP_MODULES}/@deepseek-ai"/*/; do
  name=$(basename "$pkg")
  [[ "$name" == .* ]] && continue
  ln -sfn "$pkg" "${FIXTURE_HOME}/profiles/web/node_modules/@deepseek-ai/$name"
done
for dir in "${DSH_APP_MODULES}/"@"*"*/; do
  scope=$(basename "$dir")
  [[ "$scope" == "@deepseek-ai" || "$scope" == .* ]] && continue
  mkdir -p "${FIXTURE_HOME}/profiles/web/node_modules/$scope"
  for pkg in "$dir"*/; do
    name=$(basename "$pkg")
    [[ "$name" == .* ]] && continue
    ln -sfn "$pkg" "${FIXTURE_HOME}/profiles/web/node_modules/$scope/$name"
  done
done
for pkg in "${DSH_APP_MODULES}"/*/; do
  name=$(basename "$pkg")
  [[ "$name" == @* || "$name" == .* ]] && continue
  ln -sfn "$pkg" "${FIXTURE_HOME}/profiles/web/node_modules/$name"
done

# dsh-grokbot link（fixture 专用，指向待测项目目录）
ln -sfn "${PROJECT_DIR}" "${FIXTURE_HOME}/profiles/web/node_modules/dsh-grokbot"

# 所有权标记（cleanup 仅删有此标记的目录）
echo "${RUN_ID}" > "${FIXTURE_HOME}/.dsh-perf-fixture-owner"

# 验证生成的 package.json 是合法 JSON
node -e "
const pkg = JSON.parse(require('fs').readFileSync('${FIXTURE_HOME}/profiles/web/package.json', 'utf8'));
if (!pkg.dependencies['dsh-grokbot'] || !pkg.dsh.profile.bundles.includes('dsh-grokbot')) {
  console.error('[setup] VERIFY FAIL: package.json missing grokbot');
  process.exit(1);
}
console.log('[setup] package.json OK:', pkg.dependencies['dsh-grokbot'].slice(0, 40) + '...');
"

echo "[setup] fixture ready: ${FIXTURE_HOME}"
echo "FIXTURE_DIR=${FIXTURE_HOME}"
