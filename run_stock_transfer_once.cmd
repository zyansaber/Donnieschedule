@echo off
setlocal

cd /d "%~dp0"

set "VENV_DIR=%~dp0.venv-stock-transfer"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"

if not exist "%VENV_PY%" (
  echo Creating local Python environment...
  py -3 -m venv "%VENV_DIR%"
  if errorlevel 1 (
    echo Failed to create Python environment.
    echo Please install Python 3 or make sure the py launcher is available.
    pause
    exit /b 1
  )
)

echo Checking Python packages...
"%VENV_PY%" -c "import firebase_admin, pandas, pyodbc, openpyxl" >nul 2>nul
if errorlevel 1 (
  echo Installing required Python packages...
  "%VENV_PY%" -m pip install --upgrade pip
  if errorlevel 1 (
    echo Failed to upgrade pip.
    pause
    exit /b 1
  )

  "%VENV_PY%" -m pip install -r requirements-stock-transfer.txt
  if errorlevel 1 (
    echo Failed to install required Python packages.
    pause
    exit /b 1
  )
)

echo Running stock_transfer SAP sync once...
echo.
"%VENV_PY%" stock_transfer.py --once --limit 0
if errorlevel 1 (
  echo.
  echo Stock transfer SAP sync failed.
  pause
  exit /b 1
)

echo.
echo Done. This window can be closed.
pause
