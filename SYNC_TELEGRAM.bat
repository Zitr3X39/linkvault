@echo off
chcp 65001 >nul
title LinkVault - сбор ссылок из Telegram
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] Python не найден.
  echo      Скачай с https://python.org/downloads и при установке поставь галочку
  echo      "Add python.exe to PATH".
  echo.
  pause
  exit /b 1
)

python "sync\tg_sync.py"
if errorlevel 1 goto err

if "%~1"=="/auto" (
  call "%~dp0PUBLISH.bat" /auto
  goto :eof
)

echo.
set /p GO="  Выложить на сайт прямо сейчас? (y/n): "
if /i "%GO%"=="y" call "%~dp0PUBLISH.bat" /auto
echo.
pause
goto :eof

:err
echo.
echo  Что-то пошло не так. Смотри сообщение выше.
echo.
pause
