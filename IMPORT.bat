@echo off
chcp 65001 >nul
title LinkVault - импорт ссылок из файлов
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] Python не найден. Скачай с https://python.org/downloads
  echo      и поставь галочку "Add python.exe to PATH".
  echo.
  pause
  exit /b 1
)

if not exist "inbox" mkdir inbox
echo  Можно перетащить файлы мышкой на этот IMPORT.bat
echo  или положить их в папку inbox\
echo.

python "sync\import_files.py" %*

echo.
pause
