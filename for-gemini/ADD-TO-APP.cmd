@echo off
rem Checks Gemini's speaker files in "results" and adds them to the app.
node "%~dp0..\server\add-speakers.mjs"
echo.
pause
