@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Flash Otto firmware
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\flash-firmware.ps1"
if errorlevel 1 pause
exit /b 0
