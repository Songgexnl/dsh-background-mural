#!/usr/bin/env bash
# Mural -> GitHub. Use this from Git Bash / WSL / macOS / Linux.
set -uo pipefail
cd "$(dirname "$0")"

HTTPS_URL="https://github.com/Songgexnl/dsh-background-mural.git"
SSH_URL="git@github.com:Songgexnl/dsh-background-mural.git"

echo "== checking SSH access to GitHub =="
if ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10 -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
  REMOTE="$SSH_URL"
  echo "   SSH key is registered - using $REMOTE"
else
  REMOTE="$HTTPS_URL"
  echo "   no working SSH key - falling back to HTTPS"
  echo "   (GitHub wants a Personal Access Token there, not your password)"
fi

if [ ! -d .git ]; then
  git init -b main
  git remote add origin "$REMOTE"
else
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$REMOTE"
  else
    git remote add origin "$REMOTE"
  fi
fi

git add -A
git -c user.name="Songgexnl" -c user.email="754596277@qq.com" \
  commit -m "feat: Mural - DSH background plugin with image/video upload" || true

git push -u origin main
