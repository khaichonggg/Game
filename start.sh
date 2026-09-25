#!/bin/bash
# Bumper Brawl / 碰碰球大乱斗 — start on Linux: ./start.sh (Linux 启动)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  [!] Node.js is not installed. Install the LTS version from https://nodejs.org/ and run this again."
  echo "  [!] 还没有安装 Node.js，请到 https://nodejs.org/ 下载安装 LTS 版本后再打开本文件。"
  echo
  (command -v open >/dev/null && open https://nodejs.org/) || (command -v xdg-open >/dev/null && xdg-open https://nodejs.org/)
  read -r -p "Press Enter to close / 按回车关闭 "
  exit 1
fi
BB_OPEN=1 node launcher.js
