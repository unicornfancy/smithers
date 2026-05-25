#!/bin/bash
# Smithers dev-server wrapper for launchd.
#
# Sources nvm so we get the user's default node, cd's into the repo,
# and execs pnpm dev so launchd's signal handling reaches it directly
# (no extra shell process to babysit).
#
# stdout/stderr land in ~/.smithers/dev-server.log per the plist.
# Tail it with: tail -f ~/.smithers/dev-server.log

set -euo pipefail

REPO_DIR="$HOME/smithers"
export NVM_DIR="$HOME/.nvm"

# Source nvm — launchd doesn't run a login shell so $PATH won't include
# ~/.nvm/versions/node/<v>/bin by default. nvm.sh sets it up.
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$REPO_DIR"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting smithers dev server (node=$(node --version), pnpm=$(pnpm --version))"
exec pnpm dev
