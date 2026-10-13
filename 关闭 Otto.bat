@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 关闭 Otto
node --disable-warning=ExperimentalWarning scripts\stop.mjs
timeout /t 3 >nul
exit /b 0
