@echo off
setlocal
chcp 65001 >nul
set "ROOT=%~dp0.."
if not exist "%ROOT%\resources\bundle\runtime\node.exe" (
  echo 将补丁文件夹放在画布工作台启动器.exe的同一目录，再重新运行此脚本。
  pause
  exit /b 1
)
"%ROOT%\resources\bundle\runtime\node.exe" "%~dp0update-patch.cjs" "%ROOT%"
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
