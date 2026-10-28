@echo off
title TaskFlow Pro Server
cd /d "%~dp0"
echo Starting TaskFlow Pro Server...
start "" http://localhost:8080
powershell -ExecutionPolicy Bypass -NoExit -File "server.ps1"
pause
