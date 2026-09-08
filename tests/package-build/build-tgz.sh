#!/bin/bash
# R3-A：可分享包构建——固定 SHA 的干净导出 + npm pack 实际 tgz + 清单/hash + 私人内容扫描。
# 产物写入 dist/r3/（gitignored）。不 publish。
set -euo pipefail
PROJ="$(cd "$(dirname "$0")/../.." && pwd)"
SHA="$(git -C "$PROJ" rev-parse HEAD)"
OUT="$PROJ/dist/r3"
WORK="$(mktemp -d /tmp/r3-tgz-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

# 1. 固定 SHA 干净导出（git archive 只含已提交内容——无未跟踪/私人文件/临时产物）
mkdir -p "$WORK/pkg"
git -C "$PROJ" archive "$SHA" | tar -x -C "$WORK/pkg"

# 2. 实际打包（npm pack 无需安装依赖；按 package.json files 清单）
mkdir -p "$OUT"
cd "$WORK/pkg"
NPM_TGZ="$(npm pack --pack-destination "$OUT" 2>/dev/null | tail -1)"
[ -n "$NPM_TGZ" ] || { echo "PACK FAILED"; exit 1; }
TGZ="$OUT/$(basename "$NPM_TGZ")"
[ -f "$TGZ" ] || { echo "PACK OUTPUT MISSING"; exit 1; }

# 3. 必备文件核对（main/client/patch/license）
TAR_LIST="$(tar -tzf "$TGZ")"
for want in package.json lib/index.mjs lib/client.js cordis.patch.yml LICENSE README.md; do
  echo "$TAR_LIST" | grep -qx "package/$want" || { echo "MISSING IN TGZ: $want"; exit 1; }
done

# 4. 私人内容扫描：解包后 grep 机器特定绝对路径（任意用户名）/ 凭据痕迹。
#    注意：文档中说明状态目录名（.dsh-grokbot）不属私人内容，不做字面匹配
EXTRACT="$WORK/extract"
mkdir -p "$EXTRACT"
tar -xzf "$TGZ" -C "$EXTRACT"
if grep -rn --exclude-dir=node_modules -E "/Users/[a-z]|/home/[a-z]|ZAI_API|sk-[A-Za-z0-9]{8}" "$EXTRACT" >/dev/null 2>&1; then
  echo "PRIVATE CONTENT DETECTED:"
  grep -rln --exclude-dir=node_modules -E "/Users/[a-z]|/home/[a-z]|ZAI_API|sk-[A-Za-z0-9]{8}" "$EXTRACT" | head -5
  exit 1
fi

# 5. 清单（tgz hash + 逐文件 hash + 依赖与版本记录）
python3 - "$TGZ" "$SHA" "$OUT" "$EXTRACT" <<'PY'
import hashlib, json, os, sys
tgz, sha, out, extract = sys.argv[1:5]
def h(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()
files = []
for root, _dirs, names in os.walk(extract):
    for n in sorted(names):
        p = os.path.join(root, n)
        rel = os.path.relpath(p, extract)
        files.append({'path': rel, 'sha256': h(p), 'size': os.path.getsize(p)})
manifest = {
    'gitSha': sha,
    'tgz': os.path.basename(tgz),
    'tgzSha256': h(tgz),
    'tgzBytes': os.path.getsize(tgz),
    'files': files,
    'runtimeDeps': [],
    'testEnvPinned': {'react': '19.2.8', 'react-dom': '19.2.8', 'happy-dom': '20.14.0'},
    'clientExternals': ['react', 'react-dom', '@deepseek-ai/dsh-client-*（由宿主 ModuleLoader 提供）'],
    'hostVerified': {'app': 'DSH Desktop 0.7.2', 'dshBase': '0.1.2-alpha.1', 'dshWebApp': '0.1.2-alpha.1'},
}
open(os.path.join(out, 'manifest.json'), 'w').write(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')
print(json.dumps({'tgz': manifest['tgz'], 'tgzSha256': manifest['tgzSha256'], 'files': len(files), 'gitSha': sha}))
PY

echo "OK: $TGZ"
