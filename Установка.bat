@echo off
chcp 65001 >nul
title TikTok Fix — Установка
cd /d "%~dp0"

echo ========================================================
echo               TikTok Fix — Установка
echo ========================================================
echo.

:: 1. Проверка Python
echo [1/3] Проверка Python...
where py >nul 2>&1
if %errorlevel% equ 0 (
    set "PY_CMD=py"
    goto :PYTHON_READY
)
where python >nul 2>&1
if %errorlevel% equ 0 (
    set "PY_CMD=python"
    goto :PYTHON_READY
)

echo Python не найден. Скачивание и установка Python...
powershell -NoProfile -ExecutionPolicy Bypass -Command "winget install Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements" >nul 2>&1
if %errorlevel% neq 0 (
    echo Скачивание с официального сайта python.org...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$wc = New-Object System.Net.WebClient; $wc.DownloadFile('https://www.python.org/ftp/python/3.12.3/python-3.12.3-amd64.exe', 'py_inst.exe'); Start-Process -Wait py_inst.exe -ArgumentList '/quiet InstallAllUsers=0 PrependPath=1'; Remove-Item py_inst.exe"
)

where py >nul 2>&1 && set "PY_CMD=py" && goto :PYTHON_READY
where python >nul 2>&1 && set "PY_CMD=python" && goto :PYTHON_READY

echo [!] Не удалось автоматически установить Python.
echo Установите Python вручную с https://www.python.org (отметьте галочку 'Add python.exe to PATH').
pause
exit /b 1

:PYTHON_READY
echo [+] Python обнаружен.
echo.

:: 2. Установка зависимостей
echo [2/3] Установка библиотек...
%PY_CMD% -m pip install -r requirements.txt --quiet --no-warn-script-location
echo [+] Библиотеки установлены.
echo.

:: 3. Создание ярлыка на Рабочем столе
echo [3/3] Создание ярлыка на Рабочем столе...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$sh = New-Object -ComObject WScript.Shell; " ^
  "$desk = [Environment]::GetFolderPath('Desktop'); " ^
  "$lnk = $sh.CreateShortcut(\"$desk\TikTok Fix.lnk\"); " ^
  "$pyPath = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source; " ^
  "if (-not $pyPath) { $pyPath = (Get-Command py.exe -ErrorAction SilentlyContinue).Source }; " ^
  "if (-not $pyPath) { $pyPath = 'pythonw.exe' }; " ^
  "$lnk.TargetPath = $pyPath; " ^
  "$lnk.Arguments = '\"' + '%~dp0tiktok_fix.py' + '\"'; " ^
  "$lnk.WorkingDirectory = '%~dp0'; " ^
  "$lnk.IconLocation = '%~dp0tiktok.ico,0'; " ^
  "$lnk.Description = 'TikTok Fix Desktop Client'; " ^
  "$lnk.Save();"

echo [+] Ярлык 'TikTok Fix' создан на Рабочем столе.
echo.
echo ========================================================
echo             Установка успешно завершена!
echo ========================================================
echo.
set /p START_CHOICE="Запустить TikTok Fix прямо сейчас? (y/n): "
if /i "%START_CHOICE%"=="y" (
    start "" TikTok_Fix.bat
)
