@echo off
chcp 65001 >nul
title TikTok Fix - Установка
cd /d "%~dp0"

echo ========================================================
echo               TikTok Fix - Установка
echo ========================================================
echo.

:: 1. Проверка Python
echo [1/3] Проверка Python...
set "PY_CMD="
if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" (
    set "PY_CMD=%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe"
    goto :PYTHON_READY
)
where python >nul 2>&1
if %errorlevel% equ 0 (
    set "PY_CMD=python"
    goto :PYTHON_READY
)
where py >nul 2>&1
if %errorlevel% equ 0 (
    set "PY_CMD=py"
    goto :PYTHON_READY
)

echo Python не найден. Попытка автоматической установки...
powershell -NoProfile -ExecutionPolicy Bypass -Command "winget install Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements" >nul 2>&1
where python >nul 2>&1 && set "PY_CMD=python" && goto :PYTHON_READY
where py >nul 2>&1 && set "PY_CMD=py" && goto :PYTHON_READY

echo [!] Не удалось найти или установить Python.
echo Установите Python с официального сайта https://www.python.org (отметьте 'Add python.exe to PATH').
pause
exit /b 1

:PYTHON_READY
echo [+] Python готов.
echo.

:: 2. Установка зависимостей
echo [2/3] Установка необходимых библиотек...
"%PY_CMD%" -m pip install -r requirements.txt --quiet --no-warn-script-location
echo [+] Библиотеки установлены.
echo.

:: 3. Создание ярлыка
echo [3/3] Создание ярлыка на Рабочем столе...
cscript //nologo "%~dp0create_shortcut.vbs"
echo [+] Ярлык 'TikTok Fix' создан на Рабочем столе!
echo.
echo ========================================================
echo             Установка успешно завершена!
echo ========================================================
echo.
set /p START_CHOICE="Запустить TikTok Fix прямо сейчас? (y/n): "
if /i "%START_CHOICE%"=="y" (
    start "" wscript.exe "%~dp0run_silent.vbs"
)
