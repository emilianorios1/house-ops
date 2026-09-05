# House Ops

House Ops es el sistema operativo doméstico para dos personas. La aplicación
principal es un monolito Django server-rendered y mobile-first; el ledger
financiero existente vive dentro del producto junto con tareas y rutinas.

## Qué incluye

- Home orientada a lo que necesita atención hoy.
- tareas asignables con flujo `Inbox → Doing → Done` y vista Kanban;
- rutinas domésticas recurrentes con historial y responsable de cada ejecución;
- Ledger con movimientos, obligaciones, gastos compartidos, tarjetas y Factura E;
- documentos con metadata, trazabilidad, datos parseados y PDF;
- operaciones asíncronas para Gmail, Mercado Pago, SIAT y dbt;
- Django Authentication para los dos usuarios del hogar;
- Bootstrap 5, HTMX puntual y JavaScript mínimo.

La rutina inicial **Poner veneno para hormigas** vence al instalar House Ops. Se
marca `Hecho` con un solo toque desde Home, conserva la finalización y reaparece
un mes después.

## Arquitectura

```text
Gmail / Mercado Pago / SIAT / Documents
                    ↓
                  Bronze
                    ↓
              Silver / dbt
                    ↓
               Gold / dbt
                    ↓
             House Ops / Django
```

Bronze conserva fuentes y lineage; Silver normaliza; Gold sirve consultas. Las
obligaciones y sus pagos siguen separados y se concilian explícitamente. Los PDF
continúan en almacenamiento content-addressed fuera de PostgreSQL.

Los datos operacionales (`Task`, `Routine`, completions y ejecuciones) usan ORM y
migraciones Django en el schema `public`. Ledger consulta Gold/Silver mediante SQL
acotado; no replica el warehouse como modelos ORM.

## Desarrollo reproducible

La laptop es sólo desarrollo. `docker-compose.yml` usa PostgreSQL, datos,
puertos y worktrees locales; no es la instalación productiva ni monta sus
documentos. Los comandos `scripts/dev-up.sh` y `docker compose` son para este
entorno. No se restauran snapshots de producción desde la laptop.

En el checkout principal, las tareas con cambios deben usar el worktree aislado
descripto en `AGENTS.md`. Ya dentro de un worktree:

```bash
scripts/init-worktree.sh
scripts/dev-up.sh --full
```

El primer script crea `.env`, `.venv`, puertos, proyecto Compose, volumen y rutas
exclusivos. El segundo inicia PostgreSQL, crea Bronze, ejecuta `dbt build`, aplica
migraciones, crea los usuarios iniciales y levanta `web` y `sync-runner`.

La URL exacta se obtiene con:

```bash
docker compose --env-file .env port web 8000
```

Los usernames y passwords locales se guardan con modo privado en `.env` bajo
`HOUSE_OPS_ADMIN_*` y `HOUSE_OPS_SECOND_*`. El bootstrap sólo crea usuarios
faltantes: nunca resetea una contraseña existente.

Comandos útiles:

```bash
.venv/bin/python manage.py migrate
.venv/bin/python manage.py bootstrap_house_ops
.venv/bin/home-lab transform
.venv/bin/python -m pytest
docker compose --env-file .env config
```

## Operaciones e integraciones

La web no recibe tokens externos. Envía una orden allow-listed al runner privado,
recibe `202 Accepted` y muestra el estado por polling HTMX. El runner ejecuta una
operación por vez y registra inicio, resultado, salida del comando y usuario
solicitante en PostgreSQL; la pestaña Operaciones permite abrir esos logs. No
necesita Celery ni Redis para este hogar.

La CLI `home-lab` se conserva para importaciones, parser de documentos,
sincronización, reportes y mantenimiento. Las credenciales reales permanecen en
`.env`/`secrets` y nunca deben entrar al repositorio.

## Producción

La única producción es el VPS `bordarte`, publicado en
`https://casa.bordarteuniformes.com.ar`. Conserva deliberadamente el proyecto
Compose `home-lab-prod` y el volumen `home-lab-prod-postgres-data`, de modo que
actualizar la application layer no reemplaza la base existente. La laptop no
puede operar ese Compose.

Cuando House Ops comparte un VPS con otra aplicación que ya administra Caddy,
House Ops no debe iniciar otro proxy ni publicar 80/443. El `web` se conecta a
la red `home-lab-prod-frontend` con el alias `house-ops-web`; el Caddy existente
puede enrutar un subdominio hacia `house-ops-web:8000`. Mantener
`HOME_LAB_PROD_BIND=127.0.0.1` deja el puerto de diagnóstico fuera de Internet.

```bash
ssh root@2.28.60.154
cd /opt/house-ops
scripts/install-production.sh ghcr.io/emilianorios1/house-ops:latest
```

Cada despliegue posterior usa `scripts/deploy-production.sh <imagen>`. El proceso
valida Compose, toma un backup verificable si PostgreSQL ya existe, ejecuta
`init-db`, `dbt build` y migraciones forward-only, y sólo entonces reemplaza `web`
y `sync-runner`. La salud pública es `GET /health/`. El workflow de GitHub Actions
usa exclusivamente el runner `vps-production` y no el runner de la laptop.

## Tests y QA

```bash
.venv/bin/python -m pytest
.venv/bin/home-lab transform
docker compose --env-file .env config
git diff --check
```

El smoke real de navegador usa el Chrome instalado, sin descargar otro browser:

```bash
HOUSE_OPS_E2E_BASE_URL=http://127.0.0.1:8502 \
HOUSE_OPS_E2E_USERNAME=emiliano \
HOUSE_OPS_E2E_PASSWORD='valor privado de .env' \
.venv/bin/python -m pytest tests/e2e/test_house_ops_browser.py
```

## Documentación

| Documento | Contenido |
| --- | --- |
| [Arquitectura](docs/architecture.md) | límites, paquetes y datos |
| [Aplicación web](docs/web-app.md) | Home, tareas, rutinas, Ledger y operaciones |
| [Modelo de datos](docs/data-model.md) | Bronze/Silver/Gold y modelos Django |
| [Integraciones](docs/integrations.md) | Gmail, Mercado Pago, SIAT, ARCA y documentos |
| [Operación](docs/operations.md) | worktrees, backups, deploy y recuperación |
