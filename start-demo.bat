@echo off
cd /d "%~dp0web"
if not exist node_modules call npm install
call npm run build
start "" http://localhost:4173/
call npm run preview -- --port 4173
