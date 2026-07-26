@echo off
setlocal

set "STOCK_TRANSFER_NO_PAUSE=1"
call "%~dp0run_stock_transfer_once.cmd" --scheduled
exit /b %errorlevel%
