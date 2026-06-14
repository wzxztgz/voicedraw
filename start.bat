@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo   VoiceDraw - Starting...
echo ========================================
echo.

if not exist "%~dp0server\index.js" (
  echo [ERROR] server\index.js not found.
  echo Run from voicedraw folder. Current: %~dp0
  pause
  exit /b 1
)

if not exist "%~dp0client\package.json" (
  echo [ERROR] client\package.json not found.
  pause
  exit /b 1
)

echo [1/2] Backend WebSocket ws://localhost:8765
start "VoiceDraw-Server" /D "%~dp0server" cmd /k node index.js

timeout /t 2 /nobreak >nul

echo [2/2] Frontend http://localhost:3000
start "VoiceDraw-Client" /D "%~dp0client" cmd /k npx vite --host

echo.
echo ========================================
echo   Started.
echo   Open: http://localhost:3000
echo   Close Server/Client windows to stop.
echo ========================================
echo.
pause
