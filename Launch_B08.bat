@echo off
title B08 3D Viewer
cd /d "%~dp0"
echo Starting B08 3D Web App...
node serve.js
if %errorlevel% neq 0 (
    echo Node.js not detected, trying Python http.server...
    cd dist
    start http://localhost:3000
    python -m http.server 3000
)
pause
