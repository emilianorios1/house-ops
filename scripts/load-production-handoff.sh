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
cleanup() { docker exec "$web" rm -rf -- "$remote" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# Docker's archive API rejects docker cp into a read-only rootfs, even when /tmp
# is writable. Stream validated files through exec into the existing private
# tmpfs, using the service identity and without restoring archive ownership.
tar --create --file - --directory "$bundle" . | docker exec -i "$web" sh -ec '
    umask 077
    mkdir -m 0700 -- "$1"
    tar --extract --no-same-owner --no-same-permissions --file - --directory "$1"
' sh "$remote"
docker exec "$web" node --import tsx scripts/import-handoff.ts "$remote/records.json"
docker exec "$web" node scripts/smoke-production.mjs --maintenance-session
