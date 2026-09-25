@echo off
rem Bumper Brawl / 碰碰球大乱斗 - 诊断工具：连不上的时候双击运行，把生成的报告发给开发者
chcp 65001 >nul
cd /d "%~dp0"
title Bumper Brawl - diagnose
echo.
echo   正在检查游戏服务器、网络和防火墙…  Checking the game server, network and firewall...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\diagnose.ps1" -Root "%~dp0."
echo.
echo   报告已保存到 diagnose-report.txt，并已复制，直接粘贴发给开发者就行。
echo   The report is in diagnose-report.txt and on the clipboard - paste it to the developer.
if exist "%~dp0diagnose-report.txt" start "" notepad "%~dp0diagnose-report.txt"
echo.
pause
