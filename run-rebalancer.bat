@echo off
chcp 65001 >nul
echo ========================================
echo MMT Rebalancer 測試
echo ========================================
echo.

cd /d "%~dp0"

echo 執行 node index.js --dry-run (模擬執行)
echo.

node index.js --dry-run

echo.
echo ========================================
echo 測試完成
echo ========================================
pause
