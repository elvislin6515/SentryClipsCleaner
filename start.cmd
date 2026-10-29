@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SentryClips Cleaner
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-app.ps1"
if errorlevel 1 pause
