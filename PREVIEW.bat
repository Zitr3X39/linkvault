@echo off
chcp 65001 >nul
title LinkVault - локальный просмотр
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo  [!] Python не найден. Для локального просмотра он нужен.
  pause
  exit /b 1
)

echo  Открываю http://127.0.0.1:8787/
echo  Чтобы остановить - закрой это окно.
start "" http://127.0.0.1:8787/
python -m http.server 8787 --bind 127.0.0.1
