@echo off
title Leadscraper - Fenster offen lassen
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden. Bitte von https://nodejs.org installieren und erneut starten.
  pause
  exit /b 1
)
node server.js
pause
