@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title LinkVault - публикация сайта
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] Git не найден.
  echo      Скачай с https://git-scm.com/download/win , установи по умолчанию
  echo      и запусти этот файл снова.
  echo.
  pause
  exit /b 1
)

if not exist ".git" (
  echo.
  echo  === Первый запуск ===
  echo  Создай на github.com ПУСТОЙ репозиторий и вставь ссылку на него.
  echo.
  set /p REPO="  Ссылка (https://github.com/ЛОГИН/linkvault.git): "
  git init >nul
  git branch -M main
  git remote add origin "!REPO!"
  git config user.name >nul 2>nul || git config user.name "LinkVault"
  git config user.email >nul 2>nul || git config user.email "linkvault@local"
  echo.
)

git add -A
git commit -m "LinkVault: обновление %DATE% %TIME%" >nul 2>nul
if errorlevel 1 echo  Изменений нет - публиковать нечего.

git push -u origin main
if errorlevel 1 (
  echo.
  echo  [!] Не удалось отправить. Проверь интернет и вход в GitHub.
) else (
  echo.
  echo  Готово. Через минуту сайт обновится.
)

if "%~1"=="/auto" goto :eof
echo.
pause
