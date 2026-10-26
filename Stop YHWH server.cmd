@echo off
rem Stops the YHWH Bible app server (whatever is listening on port 8787).
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { Stop-Process -Id $c.OwningProcess -Force; 'Server stopped.' } else { 'The server was not running.' }"
timeout /t 3 >nul
