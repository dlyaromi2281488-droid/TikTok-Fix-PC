@echo off
cd /d "%~dp0"
if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\pythonw.exe" (
    start "" "%LOCALAPPDATA%\Python\pythoncore-3.14-64\pythonw.exe" tiktok_fix.py
    exit /b 0
)
where pythonw >nul 2>&1
if %errorlevel% equ 0 (
    start "" pythonw.exe tiktok_fix.py
    exit /b 0
)
where python >nul 2>&1
if %errorlevel% equ 0 (
    start "" python.exe tiktok_fix.py
    exit /b 0
)
start "" py -w tiktok_fix.py
