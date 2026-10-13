@echo off
setlocal
echo Testing SSH access to GitHub with each local key...
echo (A greeting line means that key is registered on some GitHub account.)
echo.

for %%K in ("%USERPROFILE%\.ssh\id_ed25519" "%USERPROFILE%\.ssh\id_rsa") do (
  if exist %%K (
    echo ---- %%K
    ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10 -i %%K -T git@github.com
    echo.
  )
)

echo ============================================
echo  Read the lines above:
echo    "Hi ^<user^>! You've successfully authenticated" -> SSH works, run push.bat
echo    "Permission denied (publickey)"                 -> that key is not on GitHub
echo ============================================
echo.
pause
endlocal
