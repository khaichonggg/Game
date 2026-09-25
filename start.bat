@echo off
rem Bumper Brawl / 碰碰球大乱斗 - double-click to start (双击启动)
chcp 65001 >nul
cd /d "%~dp0"
title Bumper Brawl
rem 优先用 runtime\node.exe；电脑上没有 Node.js 时，第一次运行自动下载一个免安装版放进 runtime
if exist "%~dp0runtime\node.exe" goto bundled
where node >nul 2>nul
if not errorlevel 1 goto run
echo.
echo   First run: downloading Node.js (about 30 MB, only once)...
echo   第一次运行：正在自动下载 Node.js（约 30MB，只需要一次，不用安装）...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\get-node.ps1" -Dest "%~dp0runtime"
if not exist "%~dp0runtime\node.exe" goto nonode
:bundled
set "PATH=%~dp0runtime;%PATH%"
:run
set BB_OPEN=1
node launcher.js
echo.
pause
exit /b
:nonode
echo.
echo   [!] Could not download Node.js automatically (check your internet connection).
echo       Or install the LTS version from https://nodejs.org/ and double-click start.bat again.
echo.
echo   [!] 自动下载 Node.js 失败（请检查网络后再双击 start.bat）
echo       也可以到 https://nodejs.org/ 下载安装 LTS 版本，装好后再双击 start.bat。
echo.
start "" https://nodejs.org/
pause
