#!/usr/bin/env bash
# =============================================================================
# 一键本地打包 DeepSeek Harness 桌面应用
# 对应手动流程：1) 装 pake → 2) 启动 dsh web → 3) pake 打包
#
# 用法：./scripts/build-locally.sh [版本号]      （默认 0.1.0）
# 可选环境变量：APP_URL（默认 http://127.0.0.1:3080/）、DSH_CMD（默认 "dsh web"）
# =============================================================================
set -euo pipefail

APP_URL="${APP_URL:-http://127.0.0.1:3080/}"
APP_VERSION="${1:-0.1.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> [1/3] 检查 pake-cli"
if ! command -v pake >/dev/null 2>&1; then
  pnpm install -g pake-cli
fi
pake --version 2>/dev/null | head -1 || pake --version

echo "    [1/3+] 补丁 pake capability（放行 http 本地服务调用 shell.open）"
node "$ROOT/scripts/patch-pake-capability.js"

echo "==> [2/3] 确保 dsh web 已启动 ($APP_URL)"
if ! curl -sf --max-time 2 "$APP_URL" >/dev/null 2>&1; then
  echo "    dsh web 未运行，正在后台启动: $DSH_CMD ..."
  ($DSH_CMD > /tmp/dsh-web.log 2>&1 &)
  for _ in $(seq 1 30); do
    curl -sf --max-time 1 "$APP_URL" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -sf --max-time 2 "$APP_URL" >/dev/null 2>&1 \
    || { echo "    ✗ dsh web 启动失败，日志: /tmp/dsh-web.log"; exit 1; }
fi
echo "    dsh web OK"

echo "==> [3/3] pake 打包 macOS/Windows/Linux（按当前系统）"
# TAURI_BUNDLER_DMG_IGNORE_CI：规避 create-dmg 在部分 macOS 环境下的 CI 检测报错
TAURI_BUNDLER_DMG_IGNORE_CI="${TAURI_BUNDLER_DMG_IGNORE_CI:-true}" pake "$APP_URL" \
  --name DeepSeekHarness \
  --title "DeepSeek Harness" \
  --identifier com.deepseekharness.app \
  --icon assets/icon.png \
  --width 1280 --height 800 \
  --app-version "$APP_VERSION" \
  --inject scripts/external-links.js

echo ""
echo "==> 完成！安装包已生成到项目根目录："
ls -1 *.dmg *.app *.msi *.exe *.deb *.rpm *.AppImage 2>/dev/null || true
echo ""
echo "    安装："
echo "      macOS  双击 .dmg 拖入 Applications（或在 Finder 中点 [打开] 两次绕过 Gatekeeper）"
echo "      Windows 双击 .msi / .exe"
echo "      Linux  sudo dpkg -i *.deb  或  chmod +x *.AppImage && ./xxx.AppImage"
echo "    提示：应用只是外壳，使用前需先在本机启动 dsh web。"