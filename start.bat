@echo off
chcp 65001 >nul
echo ========================================
echo   声绘 VoiceDraw - 启动中...
echo ========================================
echo.

REM 启动后端服务
echo [1/2] 启动后端 WebSocket 服务 (端口 8765)...
start "VoiceDraw Server" /B cmd /c "cd /d %~dp0server && node index.js"
timeout /t 2 /nobreak >nul

REM 启动前端开发服务器
echo [2/2] 启动前端开发服务器 (端口 3000)...
start "VoiceDraw Client" /B cmd /c "cd /d %~dp0client && npx vite --host"

echo.
echo ========================================
echo   启动完成！
echo   前端: http://localhost:3000
echo   后端: ws://localhost:8765
echo ========================================
echo.
echo 按 Ctrl+C 停止所有服务
echo.

REM 等待用户中断
waitfor /t 3600 pause >nul 2>&1 || echo.
