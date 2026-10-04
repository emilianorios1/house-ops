#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$(hostname -s)" == bordarte ]] || { echo "VPS identity mismatch" >&2; exit 1; }
printf 'Host: %s; operator: %s\n' "$(hostname -s)" "$(id -un)"
curl --fail --silent --show-error --location https://casa.bordarteuniformes.com.ar/health/ >/dev/null
web="$(docker ps -q --filter label=com.docker.compose.project=home-lab-prod --filter label=com.docker.compose.service=web)"
postgres="$(docker ps -q --filter label=com.docker.compose.project=home-lab-prod --filter label=com.docker.compose.service=postgres)"
[[ -n "$web" && -n "$postgres" ]] || { echo "Active production services not found" >&2; exit 1; }
docker inspect --format 'Web image: {{.Config.Image}}; health: {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$web"
docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}Documents: {{.Source}}{{end}}{{end}}' "$web"
docker inspect --format '{{range $name,$network := .NetworkSettings.Networks}}Network: {{$name}}; aliases: {{json $network.Aliases}}{{println}}{{end}}' "$web"
docker exec "$postgres" sh -ec 'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --command="SELECT to_regclass('\''gold.shared_expense_items'\'') IS NOT NULL, to_regclass('\''gold.documents'\'') IS NOT NULL, to_regclass('\''public.auth_user'\'') IS NOT NULL, to_regclass('\''public.shared_expenses'\'') IS NOT NULL"'
docker exec "$web" sh -ec 'test -d /data; printf "Stored PDFs: "; find /data -type f -name "*.pdf" | wc -l'
proxy="$(docker ps -q --filter ancestor=caddy:2)"
if [[ -z "$proxy" ]]; then proxy="$(docker ps --format '{{.ID}} {{.Image}}' | awk '$2 ~ /^caddy:/ { print $1; exit }')"; fi
[[ -n "$proxy" ]] || { echo "Active Caddy proxy not found" >&2; exit 1; }
docker inspect --format 'Proxy image: {{.Config.Image}}; networks: {{range $name,$network := .NetworkSettings.Networks}}{{$name}} {{end}}' "$proxy"
docker exec "$proxy" cat /etc/caddy/Caddyfile | awk '/casa\.bordarteuniformes\.com\.ar/{found=1} found{print} found && /^}/{exit}'
config_home="${XDG_CONFIG_HOME:-${HOME}/.config}"
config_dir="${HOME_LAB_CONFIG_DIR:-${config_home}/home-lab}"
if [[ -x "${config_dir}/production-compose.sh" ]]; then
    printf 'Production config available to operator: %s\n' "$config_dir"
else
    echo "Production config belongs to the restricted deploy operator; deploy must use its installed wrapper."
fi
