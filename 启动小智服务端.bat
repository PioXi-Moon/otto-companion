@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 小智服务端
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-xiaozhi.ps1"
if errorlevel 1 pause
exit /b 0
