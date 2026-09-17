@echo off
setlocal
set "TEMPO_LAUNCH_DIR=%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Tempo needs Node.js 20.10 or newer.
  echo Install Node.js, then double-click this launcher again.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$url='http://127.0.0.1:4317'; $ready=$false; try { $response=Invoke-WebRequest -UseBasicParsing -Uri ($url + '/api/state') -TimeoutSec 1; $ready=$response.StatusCode -eq 200 } catch {}; if (-not $ready) { Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','npm.cmd start' -WorkingDirectory $env:TEMPO_LAUNCH_DIR -WindowStyle Minimized; for ($attempt=0; $attempt -lt 40; $attempt++) { Start-Sleep -Milliseconds 250; try { $response=Invoke-WebRequest -UseBasicParsing -Uri ($url + '/api/state') -TimeoutSec 1; if ($response.StatusCode -eq 200) { $ready=$true; break } } catch {} } }; if (-not $ready) { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Tempo could not start. Open the minimized server window for details.','Tempo') | Out-Null; exit 1 }"

if errorlevel 1 exit /b 1
start "" "http://127.0.0.1:4317"

endlocal
