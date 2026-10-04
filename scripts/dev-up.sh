#!/usr/bin/env bash
set -Eeuo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
if (( $# > 1 )) || { (( $# == 1 )) && [[ "$1" != "--full" ]]; }; then
    echo "Usage: $0 [--full]. Production snapshots are VPS-only." >&2
    exit 2
fi
npm run dev:setup
if [[ "${1:-}" == "--full" ]]; then
    exec npm run dev
fi
echo "Local PostgreSQL ready. Open http://localhost:3000 after npm run dev."
