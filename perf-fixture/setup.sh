#!/bin/bash
# 构建独立效率采样 fixture（首次使用）
set -euo pipefail

DSH_APP_MODULES="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules"
FIXTURE_HOME="/tmp/dsh-perf-fixture"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

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

# profile package.json（bundles 引用）
cat > "${FIXTURE_HOME}/profiles/web/package.json" <<'EOF'
{
  "name": "dsh-perf-fixture-profile",
  "private": true,
  "dependencies": {
    "dsh-grokbot": "link:'"${PROJECT_DIR}"'"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-grokbot"
      ]
    }
  }
}
EOF

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

# node_modules：DSH Desktop.app 的 @deepseek-ai 包（只读 link）
for pkg in "${DSH_APP_MODULES}/@deepseek-ai"/*/; do
  name=$(basename "$pkg")
  [[ "$name" == .* ]] && continue
  ln -sfn "$pkg" "${FIXTURE_HOME}/profiles/web/node_modules/@deepseek-ai/$name"
done

# 非 @deepseek-ai scope 的包
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

# 非 scope 的包
for pkg in "${DSH_APP_MODULES}"/*/; do
  name=$(basename "$pkg")
  [[ "$name" == @* || "$name" == .* ]] && continue
  ln -sfn "$pkg" "${FIXTURE_HOME}/profiles/web/node_modules/$name"
done

# dsh-grokbot link（fixture 专用，不影响用户安装）
ln -sfn "${PROJECT_DIR}" "${FIXTURE_HOME}/profiles/web/node_modules/dsh-grokbot"

echo "[setup] fixture ready at ${FIXTURE_HOME}"
echo "[setup] required env: ZAI_API_KEY (export before running sample.mjs)"
