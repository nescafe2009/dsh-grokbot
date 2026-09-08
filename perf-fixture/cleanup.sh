#!/bin/bash
# 清理独立采样 fixture（仅限有所有权标记的目录）
# 用法：./cleanup.sh /tmp/dsh-perf-fixture-<run-id>
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "[cleanup] usage: $0 <fixture-dir>"
  exit 1
fi

# 所有权校验：必须包含 .dsh-perf-fixture-owner 标记
if [ ! -f "${TARGET}/.dsh-perf-fixture-owner" ]; then
  echo "[cleanup] REFUSE: ${TARGET} has no marker"
  exit 1
fi

# 目录名必须匹配 dsh-perf-fixture- 前缀
if [[ ! "$(basename "$TARGET")" =~ ^dsh-perf-fixture- ]]; then
  echo "[cleanup] REFUSE: name mismatch"
  exit 1
fi

rm -rf "$TARGET"
echo "[cleanup] removed ${TARGET}"
