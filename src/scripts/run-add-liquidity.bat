@echo off
REM MMT Add Liquidity Script Runner
REM 用於手動觸發流動性重新平衡
REM
REM 使用方式:
REM   run-add-liquidity.bat                                      - 執行重新平衡 (預設 ±0.01%)
REM   run-add-liquidity.bat --dry-run                            - 模擬執行（不送交易）
REM   run-add-liquidity.bat --range 0.02                         - 使用 ±0.02% 範圍
REM   run-add-liquidity.bat --dry-run --range 0.05               - 模擬 ±0.05%
REM   run-add-liquidity.bat --env-path "C:\path\to\.env"         - 指定 .env 檔案位置

echo ========================================
echo MMT Add Liquidity - Manual Trigger
echo ========================================
echo.

cd /d "%~dp0"

REM 如果沒有指定 --env-path，檢查預設位置
echo %* | findstr /I "--env-path" >nul
if errorlevel 1 (
    if not exist "..\..\.env" (
        echo [ERROR] .env file not found at ..\..!
        echo Please specify it using --env-path parameter or place it at the Code directory root.
        echo.
        echo Example:
        echo   run-add-liquidity.bat --env-path "C:\path\to\.env"
        pause
        exit /b 1
    )
)

REM 檢查 node_modules
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
)

echo [INFO] Running add-liquidity script...
echo [INFO] Arguments: %*
echo.

node scripts/add-liquidity.js %*

if errorlevel 1 (
    echo.
    echo [ERROR] Script execution failed
    pause
    exit /b 1
) else (
    echo.
    echo [SUCCESS] Script completed
)

pause