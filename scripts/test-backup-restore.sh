#!/usr/bin/env bash
set -Eeuo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_dir="$(mktemp -d)"
backup_path="${fixture_dir}/synthetic.dump"
container_name="casa-backup-fixture-$$-${RANDOM}"
cleanup() {
    docker rm --force "$container_name" >/dev/null 2>&1 || true
    rm -f -- "$backup_path"
    rmdir -- "$fixture_dir"
}
trap cleanup EXIT
docker run --detach --rm --name "$container_name" --network none \
    --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev \
    --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
ready=false
for _ in {1..30}; do
    if docker exec "$container_name" pg_isready --host 127.0.0.1 --username postgres --dbname postgres >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
done
[[ "$ready" == true ]] || { echo "Synthetic PostgreSQL did not start" >&2; exit 1; }
docker exec "$container_name" psql --host 127.0.0.1 --username postgres --dbname postgres \
    --set ON_ERROR_STOP=1 --command="CREATE SCHEMA bronze; CREATE TABLE bronze.restore_fixture (id integer PRIMARY KEY); INSERT INTO bronze.restore_fixture VALUES (1);" >/dev/null
docker exec "$container_name" pg_dump --host 127.0.0.1 --username postgres --dbname postgres --format=custom > "$backup_path"
# This explicit synthetic artifact never reads production configuration or records.
bash "$repo_root/scripts/verify-production-backup.sh" "$backup_path"
echo "PASS: synthetic backup restored after final TCP readiness; no production data used."
