@echo off
setlocal enabledelayedexpansion
echo =========================================================
echo AdPlay Startup Script (Windows)
echo =========================================================
echo.

:: Check if Node.js is installed
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed or not in your PATH. 
    echo Please install Node.js from https://nodejs.org/
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

:: Discover local IP for TV access
set IP=localhost
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set tempIP=%%a
    set tempIP=!tempIP: =!
    if not "!tempIP!"=="127.0.0.1" set IP=!tempIP!
)

echo [1] Development Mode (Fast updates, opens 2 windows)
echo [2] Production Build ^& Run (Signage ready, most stable)
echo.
set /p choice="Select mode [1/2]: "

if "%choice%"=="2" goto production
goto development

:development
echo Starting in DEVELOPMENT mode...
cd backend
if not exist node_modules call npm install
start "AdPlay Backend" cmd /c "npm run dev"
cd ..

cd frontend
if not exist node_modules call npm install
start "AdPlay Frontend" cmd /c "npm run start"
cd ..
goto finish_dev

:production
echo Starting in PRODUCTION mode...
echo.
echo Step 1: Building Frontend (this may take a minute^)...
cd frontend
if not exist node_modules call npm install
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Frontend build failed!
    pause
    exit /b 1
)
cd ..

echo Step 2: Starting Server...
cd backend
if not exist node_modules call npm install
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Backend build failed!
    pause
    exit /b 1
)
start "AdPlay Server" cmd /c "npm run start:prod"
cd ..
goto finish_prod

:finish_dev
echo.
echo AdPlay is starting up in DEV mode!
echo Local:    http://localhost:4200
echo On TV:    http://%IP%:4200
goto end

:finish_prod
echo.
echo AdPlay is starting up in PRODUCTION mode!
echo Local:    http://localhost:3000
echo On TV:    http://%IP%:3000
goto end

:end
echo.
echo Press any key to close this window (the app will keep running).
pause >nul
