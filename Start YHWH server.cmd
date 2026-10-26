@echo off
rem Starts the YHWH Bible app server in the background (no window stays open).
cd /d X:\bibleStudyTool\server
powershell -NoProfile -Command "try { Invoke-WebRequest http://localhost:8787/ -UseBasicParsing -TimeoutSec 3 | Out-Null; exit 1 } catch { exit 0 }"
if errorlevel 1 (
  echo The server is already running.
) else (
  wscript run-hidden.vbs node server.mjs
  echo Server started. The app is at https://beast.tailccf7aa.ts.net:8443
)
timeout /t 4 >nul
