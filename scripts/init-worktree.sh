#!/usr/bin/env bash
set -Eeuo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "${repo_root}/.git" ]]; then
    echo "Use a linked Git worktree for development." >&2
    exit 1
fi
cd "$repo_root"
npm install
npm run dev:setup
echo "Worktree ready. Start it with npm run dev (http://localhost:3000)."
