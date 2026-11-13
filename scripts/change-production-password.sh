#!/usr/bin/env bash
# Do not allow shell tracing to expose terminal input or the stdin pipeline.
set +x
set -Eeuo pipefail

if [[ "$(hostname -s)" != bordarte ]]; then
    echo "Este comando sólo se ejecuta en el VPS bordarte." >&2
    exit 1
fi
if (( $# != 1 )) || [[ "$1" != vitoria && "$1" != emiliano ]]; then
    echo "Uso: bash scripts/change-production-password.sh <vitoria|emiliano>" >&2
    exit 2
fi
if [[ ! -t 0 || ! -t 1 ]]; then
    echo "Usá una terminal interactiva para ingresar la contraseña oculta." >&2
    exit 1
fi
username="$1"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config_home="${XDG_CONFIG_HOME:-${HOME}/.config}"
config_dir="${HOME_LAB_CONFIG_DIR:-${config_home}/home-lab}"
compose_command="${config_dir}/production-compose.sh"
[[ -x "$compose_command" ]] || { echo "No se encontró la instalación existente." >&2; exit 1; }
exec 9>"${config_dir}/deployment.lock"
flock -n 9 || { echo "Hay otra operación de mantenimiento o despliegue en curso." >&2; exit 1; }
curl --fail --silent --show-error https://casa.bordarteuniformes.com.ar/health/ >/dev/null
web_container="$("$compose_command" ps -q web)"
[[ -n "$web_container" && "$web_container" != *$'\n'* ]] || { echo "No se identificó un único contenedor web." >&2; exit 1; }
docker inspect --format 'Imagen activa: {{.Config.Image}}' "$web_container"
docker inspect --format '{{json .NetworkSettings.Networks}}' "$web_container" | grep -q house-ops-web || {
    echo "No se confirmó el servicio detrás del dominio de Casa." >&2; exit 1;
}
# Send only source code as an argument. The secret travels exclusively on stdin.
source_code="$(cat "${repo_root}/scripts/change-password.ts")"
source_code+=$'\nrunPasswordChange(process.argv[1]);\n'
trap 'unset new_password confirmation' EXIT
trap 'printf "\nOperación cancelada.\n" >&2; exit 130' INT TERM HUP
printf 'Nueva contraseña para %s (9 a 128 caracteres): ' "$username"
IFS= read -r -s new_password || { printf '\nOperación cancelada.\n' >&2; exit 1; }
printf '\nRepetí la contraseña: '
IFS= read -r -s confirmation || { printf '\nOperación cancelada.\n' >&2; exit 1; }
printf '\n'
[[ "$new_password" == "$confirmation" ]] || { echo "Las contraseñas no coinciden. No se cambió nada." >&2; exit 1; }
# Validate character length in Node, using exactly the same rules as the tool.
printf '%s' "$new_password" | docker exec -i --workdir /app/scripts "$web_container" \
    node /app/node_modules/tsx/dist/cli.mjs --eval "$source_code" "$username"
