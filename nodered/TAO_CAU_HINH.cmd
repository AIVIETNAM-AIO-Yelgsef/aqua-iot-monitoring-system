@echo off
set "TARGET=%~dp0config.local.ps1"
if not exist "%TARGET%" copy "%~dp0config.example.ps1" "%TARGET%" >nul
start "" notepad.exe "%TARGET%"
echo Da mo config.local.ps1. Dien Firebase, Telegram va OpenAI roi luu tep.
pause
