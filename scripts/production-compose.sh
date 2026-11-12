#!/usr/bin/env bash
set -Eeuo pipefail

config_home="${XDG_CONFIG_HOME:-${HOME}/.config}"
config_dir="${HOME_LAB_CONFIG_DIR:-${config_home}/home-lab}"
compose_file="${config_dir}/compose.production.yaml"
prod_env="${config_dir}/prod.env"
deployment_env="${config_dir}/deployment.env"
vapid_env="${config_dir}/vapid.env"

if [[ "$(hostname -s)" != "bordarte" ]]; then
    echo "Production is VPS-only (bordarte); use docker-compose.yml for local development." >&2
    exit 1
fi

for required_file in "$compose_file" "$prod_env" "$deployment_env"; do
    if [[ ! -f "$required_file" ]]; then
        echo "Missing production file: $required_file" >&2
        exit 1
    fi
done

env_files=(--env-file "$prod_env" --env-file "$deployment_env")
if [[ -f "$vapid_env" ]]; then env_files+=(--env-file "$vapid_env"); fi
exec docker compose \
    "${env_files[@]}" \
    -f "$compose_file" \
    "$@"
