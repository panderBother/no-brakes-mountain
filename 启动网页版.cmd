@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "try { if ((Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 (
  start "" "http://127.0.0.1:5173/"
  exit /b 0
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)
echo Open http://127.0.0.1:5173 in your browser.
call npm run dev -- --open
