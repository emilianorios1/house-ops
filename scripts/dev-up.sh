#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_root}/.env"
full=false
snapshot=false

for argument in "$@"; do
    case "$argument" in
        --full) full=true ;;
        --snapshot) snapshot=true ;;
        *) echo "Usage: $0 [--full] [--snapshot]" >&2; exit 2 ;;
    esac
done

if [[ ! -f "$env_file" ]]; then
    echo "Missing $env_file; initialize this checkout first" >&2
    exit 1
fi
if [[ "$snapshot" == true && ! -f "${repo_root}/.git" ]]; then
    echo "--snapshot is only available in linked Git worktrees" >&2
    exit 1
fi

compose() {
    docker compose --env-file "$env_file" -f "${repo_root}/docker-compose.yml" "$@"
}

cd "$repo_root"
compose up -d --wait --wait-timeout 120 postgres

if [[ "$snapshot" == true ]]; then
    # Expansion is intentionally performed inside the PostgreSQL container.
    # shellcheck disable=SC2016
    has_schema="$(
        compose exec -T postgres sh -ec \
            'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
                --tuples-only --no-align \
                --command="select to_regnamespace('\''bronze'\'') is not null"'
    )"
    if [[ "$has_schema" != "t" ]]; then
        backup_path="$("${repo_root}/scripts/backup-production.sh")"
        [[ -s "$backup_path" ]] || {
            echo "Production backup is missing or empty: $backup_path" >&2
            exit 1
        }
        echo "Restoring current production snapshot into the worktree database"
        # Expansion is intentionally performed inside the PostgreSQL container.
        # shellcheck disable=SC2016
        compose exec -T postgres sh -ec \
            'exec pg_restore --username="$POSTGRES_USER" \
                --dbname="$POSTGRES_DB" --no-owner --no-privileges \
                --single-transaction --exit-on-error' \
            < "$backup_path"
    fi
fi

.venv/bin/home-lab init-db
if [[ "$snapshot" == true ]]; then
    DOCUMENT_STORE_PATH="${HOME}/.local/share/home-lab/production/bronze/gmail" \
        .venv/bin/home-lab parse-documents
else
    .venv/bin/home-lab parse-documents
fi
.venv/bin/home-lab transform
.venv/bin/python manage.py migrate --noinput
.venv/bin/python manage.py bootstrap_house_ops

if [[ "$full" == true ]]; then
    compose up -d --build --wait --wait-timeout 180 web sync-runner
    echo "House Ops development is ready at $(compose port web 8000)"
else
    echo "PostgreSQL, Django and analytics are ready. Add --full for House Ops web."
fi
