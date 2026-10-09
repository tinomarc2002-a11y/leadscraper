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

rem Endet der Server unerwartet (Absturz), startet er von selbst neu. Gefundene Leads und das CRM sind gespeichert.
rem Code 0 = normal beendet, Code 1 = Startfehler mit Meldung - in beiden Faellen kein Neustart.
:pruefen
if %errorlevel%==0 goto ende
if %errorlevel%==1 goto ende
echo.
echo Der Server wurde unerwartet beendet und startet neu ...
timeout /t 2 >nul
node server.js --kein-browser
goto pruefen

:ende
pause
