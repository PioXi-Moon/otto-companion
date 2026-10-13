@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 启动 Otto
node --disable-warning=ExperimentalWarning scripts\launch.mjs
if errorlevel 1 pause
exit /b 0
