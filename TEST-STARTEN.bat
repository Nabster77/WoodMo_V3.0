@echo off
setlocal
REM WOODMO V3 - lokaler Testserver. Doppelklick genuegt. Nur V3-Datenbank erlaubt.
set "BRANCH=claude/excel-import-abgleich"
set "DIR=C:\Users\szmai\WOODMO\WOODMO_V3_TEST"
set "V3URL=https://tulndunkpsynkbbebenf.supabase.co"
set "REPO=https://github.com/Nabster77/WoodMo_V3.0.git"

if not exist "%DIR%\.git" (
  echo Erster Start: Projekt wird heruntergeladen ...
  git clone "%REPO%" "%DIR%" || goto :fehler
)
cd /d "%DIR%" || goto :fehler
git fetch origin || goto :fehler
git checkout "%BRANCH%" || goto :fehler
git pull origin "%BRANCH%" || goto :fehler

if not exist ".env.local" (
  echo.
  echo Einmalig: Bitte den anon-Key der V3-Datenbank einfuegen ^(Supabase, Project Settings, API, "anon public"^) und Enter druecken:
  set /p ANONKEY=Key: 
  > ".env.local" echo VITE_SUPABASE_URL=%V3URL%
  >> ".env.local" echo VITE_SUPABASE_ANON_KEY=%ANONKEY%
)

REM Sicherheitspruefung: nur die V3-Datenbank, niemals V2.
findstr /c:"tulndunkpsynkbbebenf" ".env.local" >nul || (
  echo STOPP: .env.local zeigt NICHT auf die V3-Datenbank. Datei wird nicht benutzt.
  goto :fehler
)
findstr /c:"fsztsmnxbffanyfbytnr" ".env.local" >nul && (
  echo STOPP: .env.local zeigt auf V2! Abbruch.
  goto :fehler
)
if exist ".env" (
  echo STOPP: Es gibt eine Datei .env im Ordner. Bitte loeschen oder umbenennen, damit nur .env.local gilt.
  goto :fehler
)

call npm.cmd install || goto :fehler
echo.
echo Server startet. Firefox oeffnet gleich http://127.0.0.1:5173
start "" firefox "http://127.0.0.1:5173"
call npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
goto :ende

:fehler
echo.
echo Es ist ein Fehler aufgetreten. Bitte Fenster fotografieren und an Claude schicken.
:ende
pause
