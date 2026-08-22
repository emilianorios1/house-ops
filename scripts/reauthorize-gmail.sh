#!/usr/bin/env bash
set -Eeuo pipefail

if (( $# != 0 )); then
    echo "Usage: $0" >&2
    exit 2
fi

config_home="${XDG_CONFIG_HOME:-${HOME}/.config}"
config_dir="${HOME_LAB_CONFIG_DIR:-${config_home}/home-lab}"
client_secret="${config_dir}/secrets/gmail_client_secret.json"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
home_lab="${HOME_LAB_COMMAND:-${repo_root}/.venv/bin/home-lab}"

if [[ ! -f "$client_secret" ]]; then
    echo "Missing Gmail OAuth client secret: $client_secret" >&2
    exit 1
fi
if [[ ! -x "$home_lab" ]]; then
    echo "Missing Home Lab command: $home_lab" >&2
    exit 1
fi

echo "Se abrirá Google para autorizar la lectura de Gmail."
GMAIL_CLIENT_SECRET_PATH="$client_secret" \
GMAIL_TOKEN_PATH="${config_dir}/secrets/gmail_token.json" \
exec "$home_lab" gmail-auth
