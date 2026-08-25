#!/usr/bin/env bash
# 把 Android 端的 www 资源同步到鸿蒙 rawfile，保持单一来源。
# 用法：在仓库根目录执行 bash harmony-host/scripts/copy-www.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC="$REPO_ROOT/android-host/app/src/main/assets/www"
DST="$SCRIPT_DIR/../entry/src/main/resources/rawfile/www"

if [ ! -d "$SRC" ]; then
  echo "[copy-www] 源目录不存在：$SRC" >&2
  exit 1
fi

mkdir -p "$DST"
rm -rf "${DST:?}/"*
cp -R "$SRC/." "$DST/"
echo "[copy-www] 已同步 www -> $DST"
find "$DST" -type f | wc -l | xargs -I{} echo "[copy-www] 文件数：{}"
