@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [X] Node.js was not found on this system.
  echo      Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo  Starting NEONSWEEPER local uplink...
echo.
node server.js
if errorlevel 1 pause
endlocal
