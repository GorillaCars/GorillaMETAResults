@echo off
setlocal
cd /d "%~dp0"
title Gorilla CRM Local Test

echo.
echo Gorilla CRM local test runner
echo =============================
echo.

if not exist ".env" (
  echo No .env file was found.
  echo Creating .env from .env.example now...
  copy ".env.example" ".env" >nul
  echo.
  echo Add your Google, Supabase, and CRM values to .env, then save it.
  echo This file is ignored by git and should not be pushed.
  start "" notepad ".env"
  echo.
  pause
  exit /b 1
)

set "PORT=5173"
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if /i "%%A"=="PORT" set "PORT=%%B"
)

set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  )
)

"%NODE_EXE%" --version >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js, or run this from inside Codex where the bundled Node runtime is available.
  echo.
  pause
  exit /b 1
)

echo Starting Gorilla CRM at http://localhost:%PORT%
echo Keep this window open while testing.
echo Press Ctrl+C to stop the local server.
echo.

start "" "http://localhost:%PORT%"
"%NODE_EXE%" server.js

echo.
pause
