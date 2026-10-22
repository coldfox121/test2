@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Please install Node.js first.
  pause
  exit /b 1
)

echo Starting local dev server at http://localhost:8788
echo Close the minimized server window to stop it.
start "test2 dev" /min npx.cmd wrangler pages dev public --port 8788 --persist-to .wrangler/state
timeout /t 4 >nul
start "" http://localhost:8788/admin/
