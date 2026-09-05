#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_root}/.env"
full=false

for argument in "$@"; do
    case "$argument" in
        --full) full=true ;;
        --snapshot)
            echo "Production snapshots are VPS-only; use local development data or fixtures." >&2
            exit 2
            ;;
        *) echo "Usage: $0 [--full]" >&2; exit 2 ;;
    esac
done

if [[ ! -f "$env_file" ]]; then
    echo "Missing $env_file; initialize this checkout first" >&2
    exit 1
fi
compose() {
    docker compose --env-file "$env_file" -f "${repo_root}/docker-compose.yml" "$@"
}

cd "$repo_root"
compose up -d --wait --wait-timeout 120 postgres

.venv/bin/home-lab init-db
.venv/bin/home-lab parse-documents
.venv/bin/home-lab transform
.venv/bin/python manage.py migrate --noinput
.venv/bin/python manage.py bootstrap_house_ops

if [[ "$full" == true ]]; then
    compose up -d --build --wait --wait-timeout 180 web sync-runner
    echo "House Ops development is ready at $(compose port web 8000)"
else
    echo "PostgreSQL, Django and analytics are ready. Add --full for House Ops web."
fi
