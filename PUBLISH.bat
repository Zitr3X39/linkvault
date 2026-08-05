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
  echo  Создай на github.com ПУСТОЙ репозиторий - без галочки "Add a README" -
  echo  и вставь ссылку на него.
  echo.
  set /p REPO="  Ссылка (https://github.com/ЛОГИН/linkvault.git): "
  git init >nul
  git branch -M main
  git remote add origin "!REPO!"
  echo.
)

git config user.name >nul 2>nul || git config user.name "LinkVault"
git config user.email >nul 2>nul || git config user.email "linkvault@local"

git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "LinkVault: обновление %DATE% %TIME%" >nul
  echo  Изменения сохранены.
) else (
  echo  Новых изменений нет.
)

git push -u origin main
if errorlevel 1 (
  echo.
  echo  [!] Не удалось отправить.
  echo      Если написано "rejected" или "fetch first" - запусти один раз FIX_PUSH.bat
  echo      Иначе проверь интернет и вход в GitHub.
) else (
  echo.
  echo  Готово. Через минуту сайт обновится.
)

if "%~1"=="/auto" goto :eof
echo.
pause
