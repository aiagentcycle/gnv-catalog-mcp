#!/bin/bash
# Copy the installed code from /opt/gnv-catalog-mcp/app into a clean public repository and commit it.
# No server history goes along: one clean commit per version, tagged v<version>.
# Push only with --push:  ./publish-github.sh --push
# Optional: MSG="Docs" for a commit on an already tagged version.
set -euo pipefail
APP=/opt/gnv-catalog-mcp/app
PUB=/opt/gnv-catalog-mcp/public
REMOTE=git@github-gnv-catalog:aiagentcycle/gnv-catalog-mcp.git
GIT_NAME=${GIT_NAME:-AIAgentCycle}
GIT_EMAIL=${GIT_EMAIL:-info@aiagentcycle.com}
VERSION=$(sed -nE 's/^[[:space:]]*"version":[[:space:]]*"([^"]+)".*/\1/p' "$APP/package.json" | head -n 1)
[ -n "$VERSION" ] || { echo "no version in package.json"; exit 1; }

if [ ! -d "$PUB/.git" ]; then
  git init -q -b main "$PUB"
  git -C "$PUB" remote add origin "$REMOTE"
fi
rsync -a --delete --exclude .git --exclude node_modules "$APP/" "$PUB/"
cd "$PUB"

# Last safety net: nothing that looks like a key, a token or an address of this host.
# Patterns are built at runtime so the addresses never appear in the repository itself.
# Extra patterns (one extended regex per line) can be kept outside the repo in /etc/gnv-catalog-mcp/publish-deny.
# Each pattern is written so that it does not match its own text in this script.
PATTERNS='BEGIN [A-Z ]*PRIVATE KEY|CLAUDE_CODE_OAUTH_TOKEN=[A-Za-z0-9]|NTFY_URL=https?:|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|x-gnv-agent-secret:[[:space:]]*[A-Za-z0-9]'
for ip in $(hostname -I 2>/dev/null || true); do
  case "$ip" in 127.*|::1|fe80:*) continue ;; esac
  PATTERNS="$PATTERNS|$(printf '%s' "$ip" | sed 's/[.]/\\./g')"
done
if [ -f /etc/gnv-catalog-mcp/publish-deny ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && [ "${line#\#}" = "$line" ] && PATTERNS="$PATTERNS|$line"
  done < /etc/gnv-catalog-mcp/publish-deny
fi
if grep -rIlE "$PATTERNS" . --exclude-dir=.git; then
  echo "REFUSED: possible secret or server address found"; exit 1
fi

git add -A
if git diff --cached --quiet; then echo "nothing new (v$VERSION)"; else
  if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
    git -c user.name="$GIT_NAME" -c user.email="$GIT_EMAIL" commit -qm "${MSG:-Docs} (v$VERSION)"
  else
    git -c user.name="$GIT_NAME" -c user.email="$GIT_EMAIL" commit -qm "v$VERSION"
    git tag "v$VERSION"
  fi
fi
git log --oneline -1
if [ "${1:-}" = "--push" ]; then
  git push -q origin main --tags && echo "pushed to github.com/aiagentcycle/gnv-catalog-mcp"
fi
true
