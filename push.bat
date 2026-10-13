@echo off
setlocal
cd /d "%~dp0"

set "HTTPS=https://github.com/Songgexnl/dsh-background-mural.git"
set "SSH=git@github.com:Songgexnl/dsh-background-mural.git"

echo ============================================
echo  Mural - push dsh-background-mural to GitHub
echo ============================================
echo  directory: %CD%
echo.

git --version >nul 2>&1
if errorlevel 1 goto NOGIT

echo [1/5] checking SSH access to GitHub ...
ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10 -T git@github.com 2>&1 | findstr /C:"successfully authenticated" >nul
if errorlevel 1 goto NOAUTH

echo       SSH key is registered - using git@github.com
set "REMOTE=%SSH%"
goto REPO

:NOAUTH
echo       no working SSH key for GitHub - falling back to HTTPS
echo       (the push will ask for credentials; GitHub needs a Personal
echo        Access Token there, not your account password)
set "REMOTE=%HTTPS%"

:REPO
if exist ".git" goto HAVEGIT

echo [2/5] git init
git init -b main
if errorlevel 1 goto FAILED

echo [3/5] set remote origin
git remote add origin "%REMOTE%"
if errorlevel 1 goto FAILED
goto COMMIT

:HAVEGIT
echo [2/5] existing repository detected
echo [3/5] set remote origin
git remote get-url origin >nul 2>&1
if errorlevel 1 goto ADDREMOTE
git remote set-url origin "%REMOTE%"
goto COMMIT

:ADDREMOTE
git remote add origin "%REMOTE%"
if errorlevel 1 goto FAILED

:COMMIT
echo [4/5] stage and commit
git add -A
git -c user.name="Songgexnl" -c user.email="754596277@qq.com" commit -m "feat: Mural - DSH background plugin with image/video upload"
echo       (a "nothing to commit" line here just means everything was already committed)

echo.
echo [5/5] pushing to %REMOTE%
echo.
git push -u origin main
if errorlevel 1 goto PUSHFAIL

echo.
echo ============================================
echo  DONE
echo  https://github.com/Songgexnl/dsh-background-mural
echo ============================================
goto END

:NOGIT
echo ERROR: git was not found in PATH.
echo Install Git for Windows and run this again, or use "Git Bash".
goto END

:PUSHFAIL
echo.
echo ---------------------------------------------------------------
echo  Push failed. The three things it can be, in order of likelihood:
echo ---------------------------------------------------------------
echo.
echo  1) HTTPS asked for a password and you typed your account password.
echo     GitHub rejects that. Re-run and paste a Personal Access Token
echo     (create one: https://github.com/settings/tokens - tick "repo").
echo.
echo  2) "Permission denied (publickey)" over SSH.
echo     Add one of these public keys at https://github.com/settings/keys :
echo.
type "%USERPROFILE%\.ssh\id_rsa.pub" 2>nul
echo.
type "%USERPROFILE%\.ssh\id_ed25519.pub" 2>nul
echo.
echo     Then just re-run this script - it picks SSH up automatically.
echo.
echo  3) The GitHub repo already contains commits (for example a README
echo     you created in the browser). Integrate them, then push again:
echo         git pull --rebase origin main
echo         git push -u origin main
goto END

:FAILED
echo.
echo A git command above failed - read its output.

:END
echo.
pause
endlocal
