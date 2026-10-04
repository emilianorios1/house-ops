#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$(hostname -s)" == bordarte ]] || { echo "VPS identity mismatch" >&2; exit 1; }
[[ $# == 1 && -f "$1/records.json" ]] || { echo "Validated private bundle required" >&2; exit 1; }
bundle="$(realpath "$1")"
case "$bundle" in "${RUNNER_TEMP:?}/casa-handoff-"*) ;; *) echo "Bundle outside runner staging directory" >&2; exit 1 ;; esac
web="$(docker ps -q --filter label=com.docker.compose.project=home-lab-prod --filter label=com.docker.compose.service=web)"
[[ -n "$web" ]] || { echo "Production web missing" >&2; exit 1; }
remote="/tmp/casa-handoff-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
service_user="$(docker inspect --format '{{.Config.User}}' "$web")"
[[ "$service_user" =~ ^[0-9]+(:[0-9]+)?$ ]] || { echo "Expected numeric service identity" >&2; exit 1; }
cleanup() { docker exec --user 0 "$web" rm -rf -- "$remote" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker cp "$bundle" "$web:$remote"
# These temporary files are readable only inside the app container; no host
# ownership or production credentials are changed. cap_drop: ALL permits chmod
# on the files owned by the copying identity, but deliberately denies chown.
docker exec --user 0 "$web" chmod -R u+rwX,go+rX "$remote"
docker exec "$web" node --import tsx scripts/import-handoff.ts "$remote/records.json"
docker exec "$web" node scripts/smoke-production.mjs --maintenance-session
