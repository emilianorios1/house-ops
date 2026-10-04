#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$(hostname -s)" != bordarte ]]; then
    echo "Production is VPS-only (bordarte)." >&2
    exit 1
fi
if (( $# != 1 )) || [[ "$1" != *@sha256:* ]]; then
    echo "Usage: $0 <immutable-image@sha256:digest>" >&2
    exit 2
fi
image="$1"
if [[ "$image" == *$'\n'* || "$image" == *$'\r'* ]]; then exit 2; fi
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config_home="${XDG_CONFIG_HOME:-${HOME}/.config}"
config_dir="${HOME_LAB_CONFIG_DIR:-${config_home}/home-lab}"
prod_env="${config_dir}/prod.env"
deployment_env="${config_dir}/deployment.env"
compose_command="${config_dir}/production-compose.sh"
if [[ ! -f "$prod_env" || ! -f "$deployment_env" || ! -x "$compose_command" ]]; then
    echo "This cutover requires the existing VPS installation. Do not bootstrap over it." >&2
    exit 1
fi
exec 9>"${config_dir}/deployment.lock"
flock -n 9 || { echo "Deployment already running" >&2; exit 1; }
# Read-only identification of the active public path and image before any changes.
curl --fail --silent --show-error https://casa.bordarteuniformes.com.ar/health/ >/dev/null
web_container="$("$compose_command" ps -q web)"
if [[ -z "$web_container" ]]; then echo "Existing web container not found" >&2; exit 1; fi
docker inspect --format 'Active image: {{.Config.Image}}' "$web_container"
docker network inspect home-lab-prod-frontend --format '{{range .Containers}}{{println .Name}}{{end}}'
if ! docker inspect --format '{{json .NetworkSettings.Networks}}' "$web_container" | grep -q house-ops-web; then
    echo "Existing house-ops-web proxy alias not confirmed" >&2; exit 1
fi
"${config_dir}/backup-production.sh"
"${config_dir}/verify-production-backup.sh"
cp "$deployment_env" "${config_dir}/deployment.previous.env"
cp "${config_dir}/compose.production.yaml" "${config_dir}/compose.production.previous.yaml"
rollback() {
    status=$?
    trap - ERR
    cp "${config_dir}/deployment.previous.env" "$deployment_env"
    cp "${config_dir}/compose.production.previous.yaml" "${config_dir}/compose.production.yaml"
    "$compose_command" up -d --wait --wait-timeout 180 --remove-orphans || true
    echo "Cutover failed; old services restored. Original schemas and PDFs were preserved." >&2
    exit "$status"
}
trap rollback ERR
# Stop writers while copying the frozen financial snapshot. Rollback restarts them.
running_services="$("$compose_command" ps --status running --services)"
if grep -qx sync-runner <<< "$running_services"; then "$compose_command" stop sync-runner; fi
"$compose_command" stop web
install -m 0644 "$repo_root/compose.production.yaml" "${config_dir}/compose.production.yaml"
umask 077
printf 'HOME_LAB_IMAGE=%s\n' "$image" > "$deployment_env"
"$compose_command" config --quiet
"$compose_command" pull web migrate
"$compose_command" up -d --wait --wait-timeout 120 postgres
"$compose_command" run --rm migrate
"$compose_command" up -d --wait --wait-timeout 180 --remove-orphans web
curl --fail --silent --show-error https://casa.bordarteuniformes.com.ar/health/ >/dev/null
running_image="$(docker inspect --format '{{.Config.Image}}' "$("$compose_command" ps -q web)")"
if [[ "$running_image" != "$image" ]]; then echo "Image mismatch" >&2; exit 1; fi
trap - ERR
# Keep previous config for operator rollback. Never restore/drop a database automatically.
echo "Next.js deployed on the existing VPS and database. Previous config retained for rollback."
