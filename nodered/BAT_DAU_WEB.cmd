@echo off
title Aqua IoT - Bat dau web
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-aqua-iot.ps1"
echo.
echo Mo web quan ly: http://localhost:1880/
echo Node-RED Editor: http://localhost:1880/red
pause
