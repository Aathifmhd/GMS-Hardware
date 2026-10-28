@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist backend\.env (
  echo Missing backend\.env file - copy backend\.env.example to backend\.env and put your Neon DATABASE_URL in it.
  pause
  exit /b 1
)
start "" http://localhost:3000
npm start
pause
