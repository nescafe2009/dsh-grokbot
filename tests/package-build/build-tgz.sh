#!/bin/bash
# R3-A：可分享包构建——固定 SHA 干净导出 + 干净依赖从源码构建 + npm pack 实际 tgz + 清单/hash + 私人内容扫描。
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

# 2. 干净依赖 + 从源码构建（npm run build 已加固：失败立即退出、唯一临时输出、成功才替换 lib/）
cd "$WORK/pkg"
command -v pnpm >/dev/null || { echo "pnpm not found"; exit 1; }
pnpm install --prefer-offline --ignore-scripts >/dev/null 2>&1 || { echo "PNPM INSTALL FAILED"; exit 1; }
npm run build >/dev/null 2>&1 || { echo "BUILD FAILED (from source)"; exit 1; }
for f in lib/index.mjs lib/client.js; do
  [ -f "$f" ] || { echo "BUILT OUTPUT MISSING: $f"; exit 1; }
done

# 3. 实际打包（npm pack 按 package.json files 清单）
mkdir -p "$OUT"
NPM_TGZ="$(npm pack --pack-destination "$OUT" 2>/dev/null | tail -1)"
[ -n "$NPM_TGZ" ] || { echo "PACK FAILED"; exit 1; }
TGZ="$OUT/$(basename "$NPM_TGZ")"
[ -f "$TGZ" ] || { echo "PACK OUTPUT MISSING"; exit 1; }

# 4. 必备文件核对（main/client/patch/license/INSTALL）
TAR_LIST="$(tar -tzf "$TGZ")"
for want in package.json lib/index.mjs lib/client.js cordis.patch.yml LICENSE README.md docs/INSTALL.md; do
  echo "$TAR_LIST" | grep -qx "package/$want" || { echo "MISSING IN TGZ: $want"; exit 1; }
done

# 5. 私人内容扫描：任意用户名的机器绝对路径与凭据形态；命中即失败。
#    /home/bot/ 为共享电脑特性的产品常量——按匹配项剔除后复检（不整行丢弃，防同行的真实命中被掩盖）。
#    只报文件路径，不回显内容（防秘密泄露）。
EXTRACT="$WORK/extract"
mkdir -p "$EXTRACT"
tar -xzf "$TGZ" -C "$EXTRACT"
python3 - "$EXTRACT" <<'PY' || exit 1
import os, re, sys
extract = sys.argv[1]
pat = re.compile(r"/Users/[a-z][a-z0-9_-]*|/home/[a-z][a-z0-9_-]*|ZAI_API|sk-[A-Za-z0-9]{8}")
hits = []
for root, _dirs, names in os.walk(extract):
    for n in names:
        p = os.path.join(root, n)
        try:
            text = open(p, 'rb').read().decode('utf8', 'replace')
        except OSError:
            continue
        remaining = pat.sub(lambda m: '' if m.group(0).startswith('/home/bot') else m.group(0), text)
        if pat.search(remaining):
            hits.append(os.path.relpath(p, extract))
if hits:
    print('PRIVATE CONTENT DETECTED (paths only):')
    for h in hits[:10]:
        print(' -', h)
    sys.exit(1)
PY

# 6. 清单（tgz hash + 逐文件 hash + 依赖与版本记录）
python3 - "$TGZ" "$SHA" "$OUT" "$EXTRACT" <<'PY'
import hashlib, json, os, sys
tgz, sha, out, extract = sys.argv[1:5]
def h(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()
files = []
for root, _dirs, names in os.walk(extract):
    for n in sorted(names):
        p = os.path.join(root, n)
        files.append({'path': os.path.relpath(p, extract), 'sha256': h(p), 'size': os.path.getsize(p)})
manifest = {
    'gitSha': sha,
    'builtFromSource': True,
    'tgz': os.path.basename(tgz),
    'tgzSha256': h(tgz),
    'tgzBytes': os.path.getsize(tgz),
    'files': files,
    'runtimeDeps': [],
    'testEnvPinned': {'react': '19.2.8', 'react-dom': '19.2.8', 'happy-dom': '20.14.0'},
    'clientExternals': ['react', 'react-dom', '@deepseek-ai/dsh-client-*（由宿主 ModuleLoader 提供）'],
    'hostVerified': {'app': 'DSH Desktop 0.8.2', 'dshBase': '0.1.2-rc.1', 'dshWebApp': '0.1.2-rc.1'},
}
open(os.path.join(out, 'manifest.json'), 'w').write(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')
print(json.dumps({'tgz': manifest['tgz'], 'tgzSha256': manifest['tgzSha256'], 'files': len(files), 'gitSha': sha, 'builtFromSource': True}))
PY

echo "OK: $TGZ"
