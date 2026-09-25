@echo off
rem Bumper Brawl / 碰碰球大乱斗 - double-click to start (双击启动)
chcp 65001 >nul
cd /d "%~dp0"
title Bumper Brawl
rem 自带的 Node.js（免安装版压缩包里有 runtime\node.exe）优先使用
if exist "%~dp0runtime\node.exe" (
  set "PATH=%~dp0runtime;%PATH%"
  goto run
)
where node >nul 2>nul
if errorlevel 1 goto nonode
:run
set BB_OPEN=1
node launcher.js
echo.
pause
exit /b
:nonode
echo.
echo   [!] Node.js is not installed.
echo       Please install the LTS version from https://nodejs.org/ and double-click start.bat again.
echo.
echo   [!] 还没有安装 Node.js
echo       请到 https://nodejs.org/ 下载安装 LTS 版本，装好后再双击 start.bat。
echo.
start "" https://nodejs.org/
pause
