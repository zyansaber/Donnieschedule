@echo off
setlocal

cd /d "%~dp0"

set "NO_PAUSE="
if /I "%~1"=="--scheduled" set "NO_PAUSE=1"
if /I "%~1"=="--no-pause" set "NO_PAUSE=1"
if /I "%STOCK_TRANSFER_NO_PAUSE%"=="1" set "NO_PAUSE=1"

set "VENV_DIR=%~dp0.venv-stock-transfer"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"

set "PYTHON_BOOTSTRAP="
where py >nul 2>&1
if not errorlevel 1 set "PYTHON_BOOTSTRAP=py -3"
if not defined PYTHON_BOOTSTRAP (
  where python >nul 2>&1
  if not errorlevel 1 set "PYTHON_BOOTSTRAP=python"
)

if not defined PYTHON_BOOTSTRAP (
  echo Python 3 was not found on this computer.
  echo Please install Python 3 and enable the py launcher or add python.exe to PATH.
  call :maybe_pause
  exit /b 1
)

rem A copied Windows virtual environment can still point to the old computer's Python.
if exist "%VENV_PY%" (
  "%VENV_PY%" -c "import sys" >nul 2>nul
  if errorlevel 1 (
    echo The copied Python environment is not valid on this computer.
    echo Recreating the local environment...
    rmdir /s /q "%VENV_DIR%"
    if exist "%VENV_DIR%" (
      echo Failed to remove the old Python environment.
      call :maybe_pause
      exit /b 1
    )
  )
)

if not exist "%VENV_PY%" (
  echo Creating local Python environment...
  %PYTHON_BOOTSTRAP% -m venv "%VENV_DIR%"
  if errorlevel 1 (
    echo Failed to create Python environment.
    echo Please install Python 3 and make sure it is available in PATH.
    call :maybe_pause
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
    call :maybe_pause
    exit /b 1
  )

  "%VENV_PY%" -m pip install -r requirements-stock-transfer.txt
  if errorlevel 1 (
    echo Failed to install required Python packages.
    call :maybe_pause
    exit /b 1
  )
)

echo Running stock_transfer SAP sync once...
echo.
"%VENV_PY%" stock_transfer.py --once --limit 0
if errorlevel 1 (
  echo.
  echo Stock transfer SAP sync failed.
  call :maybe_pause
  exit /b 1
)

echo.
echo Done. This window can be closed.
call :maybe_pause
exit /b 0

:maybe_pause
if not defined NO_PAUSE pause
exit /b 0
