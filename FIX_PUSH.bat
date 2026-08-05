@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title LinkVault - починка публикации
cd /d "%~dp0"

if not exist "index.html" (
  echo.
  echo  [!] Этот файл надо положить В ПАПКУ LinkVault - туда, где лежит
  echo      index.html и PUBLISH.bat - и запустить оттуда.
  echo.
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] Git не найден. Поставь его с https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

echo.
echo  ================================================================
echo   Сейчас содержимое репозитория на GitHub будет заменено
echo   содержимым этой папки. Тот пустой README.md, что создал
echo   сам GitHub, исчезнет - это нормально и так задумано.
echo  ================================================================
echo.
pause

if not exist ".git" git init >nul
git branch -M main >nul 2>nul

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo.
  set /p REPO="  Ссылка на репозиторий (https://github.com/ЛОГИН/linkvault.git): "
  git remote add origin "!REPO!"
)

git config user.name >nul 2>nul || git config user.name "LinkVault"
git config user.email >nul 2>nul || git config user.email "linkvault@local"

git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "LinkVault: сайт" >nul
)

git rev-parse HEAD >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] Нечего отправлять: в папке нет файлов сайта.
  echo.
  pause
  exit /b 1
)

echo.
echo  Отправляю...
git push -u origin main --force
if errorlevel 1 (
  echo.
  echo  [!] Не ушло. Проверь интернет и вход в GitHub
  echo      и попробуй ещё раз.
) else (
  echo.
  echo  Готово. Файлы на GitHub.
  echo.
  echo  Дальше один раз на сайте GitHub:
  echo   1^) Settings - General - внизу Danger Zone - Change visibility - Public
  echo   2^) Settings - Pages - Deploy from a branch - main - / ^(root^) - Save
  echo.
  echo  Дальше обычный PUBLISH.bat будет работать без ошибок.
)

echo.
pause
