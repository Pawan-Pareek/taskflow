@echo off
title Push TaskFlow to GitHub
set "PATH=%LOCALAPPDATA%\Programs\Git\cmd;%PATH%"

echo ============================================================
echo           TaskFlow - Push to GitHub (Pawan-Pareek)
echo ============================================================
echo.
echo GitHub requires a Personal Access Token instead of your password.
echo If you need one, create it in 30 seconds at:
echo https://github.com/settings/tokens/new
echo (Check the "repo" scope, then click "Generate token")
echo.
set /p TOKEN="Paste your GitHub Token here: "
if "%TOKEN%"=="" (
    echo No token entered. Aborted.
    pause
    exit /b
)

echo.
echo Pushing code to GitHub...
git remote set-url origin https://%TOKEN%@github.com/Pawan-Pareek/taskflow.git
git push -u origin main

echo.
echo Removing token from git config for security...
git remote set-url origin https://github.com/Pawan-Pareek/taskflow.git

echo.
echo ============================================================
echo           SUCCESS! Your code is now live on GitHub!
echo ============================================================
pause
