# Operación

## Entornos aislados

| Entorno | Proyecto Compose | Web | PostgreSQL | Persistencia |
| --- | --- | --- | --- | --- |
| desarrollo en la laptop | `home-lab-dev` | `127.0.0.1` | host local | volumen y `data/` locales |
| worktree de desarrollo | `home-lab-wt-<slug>` | puerto aleatorio | puerto aleatorio | volumen y `data/` propios |
| producción en VPS `bordarte` | `home-lab-prod` | `casa.bordarteuniformes.com.ar` | sólo red interna | volumen histórico y data dir |

La laptop no es producción. Sus contenedores, puertos, worktrees y datos no
identifican el VPS, aunque conserven nombres históricos parecidos. El script
`production-compose.sh` sólo funciona en el host VPS `bordarte`.

No copies `.env`, OAuth tokens, bases ni documentos entre checkouts.

## Worktree

```bash
scripts/init-worktree.sh
scripts/dev-up.sh
scripts/dev-up.sh --full
```

`init-worktree.sh` sólo funciona en un linked worktree. Crea configuración con
modo privado, venv, puertos y nombres exclusivos. `dev-up.sh` inicia PostgreSQL,
ejecuta `init-db`, `dbt build`, migrations y bootstrap. `--full` además construye
la imagen y espera `web` y `sync-runner`.

La laptop no restaura snapshots de producción. Para pruebas locales se usan sus
datos aislados o fixtures sintéticos; los backups y documentos productivos sólo
se operan en el VPS.

## Diagnóstico local

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs -f --tail=200 web
docker compose --env-file .env logs -f --tail=200 sync-runner
curl --fail http://127.0.0.1:PUERTO/health/
```

## Instalación productiva en el VPS

```bash
ssh root@2.28.60.154
cd /opt/house-ops
scripts/install-production.sh home-lab:local
```

El instalador crea, sin imprimirlos, database password, Django secret y passwords
de los dos usuarios. Los guarda en `~/.config/home-lab/prod.env` con modo `0600`.
No reemplaza un archivo existente.

La topología productiva es:

- `postgres`: volumen `home-lab-prod-postgres-data` ya existente;
- `web`: Gunicorn read-only, `/data` read-only, redes backend/frontend;
- `sync-runner`: red backend/egress, secretos y `/data` con escritura;
- `migrate`: profile efímero para schema, dbt y migraciones;
- `tools`: CLI efímera para mantenimiento explícito.

Si el VPS ya tiene un Caddy público, no iniciar otro. El servicio `web` publica
un puerto de diagnóstico sólo en loopback y también ofrece el alias
`house-ops-web` dentro de `home-lab-prod-frontend`; el Caddy existente puede
conectarse a esa red y usar `reverse_proxy house-ops-web:8000` para el subdominio
de House Ops.

La pestaña Operaciones muestra la salida combinada de cada comando del runner
(hasta los últimos 20.000 caracteres), también cuando la operación falla. Para
diagnóstico de producción, verificar siempre `https://casa.bordarteuniformes.com.ar`
y el servicio `sync-runner` que atiende ese despliegue.

## Deploy seguro en el VPS

```bash
scripts/deploy-production.sh ghcr.io/owner/home-lab@sha256:...
```

El deploy automático corre en GitHub Actions sobre el runner `vps-production`.
El runner de la laptop no puede tomar trabajos de producción.

Secuencia:

1. toma lock para evitar dos deploys;
2. agrega sólo configuración House Ops faltante;
3. si PostgreSQL corre, crea y verifica un dump custom;
4. conserva imagen y Compose previos para rollback;
5. valida y obtiene las imágenes;
6. ejecuta `init-db`, `dbt build`, `migrate` y bootstrap;
7. reemplaza `web` y `sync-runner` con `--remove-orphans`;
8. compara la imagen realmente ejecutada;
9. comprueba `/health/`;
10. restaura automáticamente el stack previo si algo falla.

Mantener el nombre `home-lab-prod` es intencional: evita crear un volumen vacío y
perder de vista la base existente durante el cambio de producto.

## Backups

```bash
scripts/backup-production.sh
scripts/verify-production-backup.sh
```

El backup usa formato custom, archivo temporal, validación `pg_restore --list` y
rename atómico. El timer diario conserva 14 días por defecto; otro timer restaura
el último dump en un PostgreSQL temporal para verificar recuperabilidad.

Nunca ejecutar migraciones destructivas contra producción. Las migraciones House
Ops crean tablas/índices en `public`; no borran schemas financieros ni documentos.

## Credenciales e integraciones

Los JSON OAuth viven en `~/.config/home-lab/secrets/`. Los tokens de Mercado Pago,
SIAT y Afip SDK viven en `prod.env`. Para rotar Afip SDK sin mostrarlo:

```bash
scripts/set-afip-sdk-access-token.sh

# Abrir Google y volver a autorizar la lectura de Gmail
scripts/reauthorize-gmail.sh

# Ejecutar ingestas con los mismos datos persistentes de producción
~/.config/home-lab/production-compose.sh run --rm tools sync-gmail
~/.config/home-lab/production-compose.sh run --rm tools sync-mercadopago
~/.config/home-lab/production-compose.sh run --rm tools sync-siat-tgi

# Ver los calendarios y ejecutar un backup ahora
systemctl --user list-timers home-lab-backup.timer
systemctl --user list-timers home-lab-backup-verify.timer
systemctl --user start home-lab-backup.service
```

El comando de Afip SDK recrea `web`; el runner recibe las otras credenciales
únicamente desde Compose. Si Google invalida el acceso,
`scripts/reauthorize-gmail.sh` abre el consentimiento y guarda el token nuevo
directamente en la ubicación productiva.

Los secretos de Gmail deben copiarse a
`~/.config/home-lab/secrets/gmail_client_secret.json` y
`gmail_token.json`. Las demás credenciales se editan únicamente en
`~/.config/home-lab/prod.env`, cuyo modo debe permanecer en `0600`.
El token de Afip SDK se rota primero desde el proveedor y luego se carga con
`scripts/set-afip-sdk-access-token.sh`; no debe pasarse como argumento ni quedar
en el historial de la terminal.

## Validación de release

```bash
.venv/bin/python -m pytest
.venv/bin/home-lab transform
.venv/bin/python manage.py check
.venv/bin/python manage.py makemigrations --check --dry-run
docker compose --env-file .env config
bash -n scripts/*.sh
git diff --check
```

Después del deploy ejecutar Playwright contra la URL productiva y verificar
`docker compose ps`, `/health/`, navegación autenticada y ausencia de HTTP 500.
