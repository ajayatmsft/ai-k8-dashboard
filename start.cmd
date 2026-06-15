@echo off
REM Launch the K8s Local Dashboard and open it in the default browser.
cd /d "%~dp0"
echo Starting K8s Local Dashboard on http://127.0.0.1:7575 ...
start "" http://127.0.0.1:7575
node server.js
