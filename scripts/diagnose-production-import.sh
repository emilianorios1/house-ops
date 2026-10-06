#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$(hostname -s)" == bordarte ]] || exit 1
[[ $# == 1 && "$1" == ghcr.io/emilianorios1/house-ops:* ]] || exit 1
web="$(docker ps -q --filter label=com.docker.compose.project=home-lab-prod --filter label=com.docker.compose.service=web)"
data_dir="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$web")"
temporary="$(mktemp "$RUNNER_TEMP/legacy-diagnostic.XXXXXX")"
trap 'rm -f -- "$temporary"' EXIT
docker inspect --format '{{json .Config.Env}}' "$web" | python3 -c 'import json,sys; value=next(v for v in json.load(sys.stdin) if v.startswith("DATABASE_URL=")); value=value.replace("postgresql+psycopg://","postgresql://").replace("postgres+psycopg://","postgresql://"); print("Database URL scheme: "+value.split("=",1)[1].split(":",1)[0]); open(sys.argv[1],"w").write(value+"\n")' "$temporary"
docker inspect --format '{{json .Config.Env}}' "$web" | python3 -c 'import json,sys; values=json.load(sys.stdin); root=next((v.split("=",1)[1] for v in values if v.startswith("DOCUMENT_STORE_PATH=")),"/data/bronze/gmail"); assert root.startswith("/data/"); open(sys.argv[1],"a").write("LEGACY_DOCUMENT_ROOT="+root+"\n")' "$temporary"
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
    --user 0 --network home-lab-prod-backend --env-file "$temporary" \
    --mount "type=bind,source=$data_dir,target=/data,readonly" \
    --mount "type=bind,source=$GITHUB_WORKSPACE/scripts/diagnose-legacy.ts,target=/app/scripts/diagnose-legacy.ts,readonly" \
    --entrypoint node "$1" --import tsx scripts/diagnose-legacy.ts
