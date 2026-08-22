# Arquitectura

House Ops es un monolito Django desplegado junto con PostgreSQL y un runner
interno. La capa de aplicación fue reemplazada de una vez; el warehouse y las
integraciones conservan sus invariantes.

```text
Fuentes externas ──▶ pipelines home_lab ──▶ Bronze
                                               │
                                               ▼
                                      Silver / Gold (dbt)
                                               │ SQL de lectura
                                               ▼
Navegador ──▶ Django / Bootstrap / HTMX ──▶ PostgreSQL public
                    │                           Tasks / Routines / Auth
                    │ POST privado
                    ▼
              sync-runner ──▶ CLI allow-listed ──▶ fuentes / Bronze / dbt
```

## Límites

- `src/home_lab/` conserva clientes HTTP, persistencia Bronze, parsers,
  almacenamiento, CLI y transformaciones. Sus pipelines siguen siendo
  idempotentes.
- `src/house_ops/work/` contiene trabajo doméstico: Home, Task, Routine y
  RoutineCompletion.
- `src/house_ops/ledger/` contiene las pantallas financieras/documentales, las
  consultas SQL y el registro de operaciones.
- `src/house_ops/templates/` y `static/` forman la UI server-rendered.
- `dbt/` sigue siendo la única definición de Silver/Gold y de sus controles de
  calidad.

No hay una app Django por proveedor ni modelos ORM artificiales para cada vista
Gold. Los modelos operacionales usan migraciones normales en `public`; los
reportes consultan el warehouse directamente con SQLAlchemy y límites explícitos.

## Invariantes de datos

1. Bronze conserva fuente, hash, batch y metadata reproducible.
2. Un documento binario vive fuera de PostgreSQL. La base conserva path, hash,
   tamaño, parser y lineage.
3. Una factura crea una obligación. Sólo una conciliación explícita con un
   movimiento crea evidencia de pago.
4. La carga de extractos y las sincronizaciones preservan las claves de
   idempotencia existentes.
5. Las migraciones Django son forward-only y crean tablas nuevas en `public`;
   no eliminan schemas Bronze/Silver/Gold ni el camino `raw` de compatibilidad.

## Recurrencia

Routine guarda una única fecha próxima, no tareas futuras. Al completar una
rutina vencida, una transacción bloquea la fila, crea exactamente un
RoutineCompletion para la ocurrencia, atribuye el usuario, actualiza
`last_completed` y calcula la próxima fecha.

La suma mensual conserva el día cuando existe y lo ajusta al último día válido
del mes. Por ejemplo, 31/01 pasa a 28/02 o 29/02. Días, semanas, meses y años usan
la misma función determinística cubierta por tests.

## Operaciones largas

Las requests web no esperan sincronizaciones o dbt. Django crea un OperationRun y
envía su UUID al runner por la red Docker privada. El runner responde rápido,
ejecuta en un thread con un lock global y actualiza el mismo registro. Un hogar de
dos personas no justifica otra cola, broker o worker distribuido.

La web no monta `secrets/` ni recibe credenciales de Gmail, Mercado Pago o SIAT.
El runner no recibe el secret ni las contraseñas Django.

## Producción

La imagen única contiene Django, CLI y dbt. `web` corre Gunicorn como usuario sin
privilegios y sirve archivos versionados mediante WhiteNoise. `sync-runner` usa la
misma imagen con otro entrypoint y sólo él monta credenciales y datos con escritura.
El servicio `migrate` ejecuta preparación forward-only antes del reemplazo.
