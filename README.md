# Casa · Gastos compartidos

Una app para Emiliano y Vitoria: guardar facturas, ver los gastos de cada mes,
dividirlos por la mitad y saber quién adelantó dinero. Next.js + TypeScript,
PostgreSQL, Prisma, Zod, Better Auth y Tailwind. No requiere Python, Django, dbt,
Gmail, Mercado Pago, un runner de sincronización ni un proveedor de IA para funcionar.

El botón de sol/luna en la barra superior (también al iniciar sesión) alterna
entre modo claro y oscuro. La elección se guarda en ese navegador; al abrir Casa
por primera vez se respeta el modo del dispositivo.

## Casa en Android y iPhone

Desde **Instalar y avisos**, instalá Casa en Chrome para Android o elegí
**Compartir → Agregar a pantalla de inicio** en Safari para iPhone. Abre con
ícono propio y conserva los mismos datos de la web. En iPhone, ingresá una vez
desde el ícono: la sesión de Safari puede ser independiente. Necesita internet
para consultar y guardar; no guarda páginas financieras ni PDF en caché.

Better Auth mantiene la sesión durante **90 días sin usar Casa**. La apertura,
el regreso al primer plano y una consulta cada 15 minutos mientras está visible
renuevan la sesión en la base y su cookie HttpOnly (Secure bajo HTTPS, SameSite
Lax). Las lecturas de páginas del servidor no renuevan cookies. Cerrar la app o
reiniciar el teléfono conserva el ingreso; cerrar sesión, borrar datos o
desinstalar puede requerir ingresar de nuevo. Los usuarios inactivos no acceden.
No hay registro público ni cambios de contraseña expuestos. La migración desde
Auth.js requiere un nuevo ingreso y conserva los usuarios y hashes existentes,
incluidos Django. Las identidades técnicas `@casa.invalid` son internas; no se
envían correos. Las tablas de autenticación son `shared_auth_*`; los hashes
anteriores permanecen disponibles para rollback. `db:seed` agrega identidades
faltantes sin restablecer contraseñas. No editar hashes manualmente.

### Restablecer una contraseña en producción

Desde una terminal interactiva en el VPS `bordarte`, en un checkout que incluya
esta herramienta, ejecutar:

```sh
bash scripts/change-production-password.sh vitoria
```

También admite `emiliano`. Identifica la instalación existente y muestra su
imagen activa; pide la nueva contraseña dos veces sin mostrarla (9 a 128
caracteres). No requiere conocer la anterior. La contraseña viaja sólo por
entrada estándar: no pasarla como argumento ni guardarla en archivos o variables
de entorno. No ejecutar con herramientas de grabación de terminal.

El comando actualiza juntos los dos registros de acceso, cierra las sesiones del
usuario, limpia el bloqueo por intentos fallidos y registra una auditoría sin
contraseñas ni hashes. Si los registros no coinciden, el usuario está inactivo o
hay un fallo concurrente, cancela toda la operación. No modifica las tablas
históricas Django: un rollback a ese runtime conserva su contraseña anterior.
Vitoria deberá volver a ingresar en sus dispositivos con la nueva contraseña.

No requiere desplegar una imagen nueva: envía únicamente el código de la
herramienta al contenedor activo y usa su conexión existente. Requiere permisos
para operar Docker y la configuración instalada; no ejecutar desde la laptop ni
mediante el runner de despliegue. Cambiar `HOUSE_OPS_SECOND_PASSWORD` no
restablece la contraseña de un usuario existente.

### Activar avisos

Abrí Casa instalada y tocá **Activar avisos**, aceptá el permiso y usá
**Enviar aviso de prueba**. iPhone requiere iOS 16.4 o posterior. Cada teléfono
tiene sus controles de vencimientos y movimientos. Cerrar sesión desactiva sus
avisos; al volver a ingresar hay que activarlos nuevamente. Un permiso bloqueado
se cambia en los ajustes del teléfono. Los detalles e importes pueden verse en
la pantalla bloqueada: esta es la elección actual del hogar.

- A las **9:00 de Argentina**, se envía un resumen de facturas pendientes que
  vencen hoy o mañana. Excluye Internet, gastos archivados y facturas pagadas;
  descuenta pagos parciales y omite pagos anulados. Sin fecha de vencimiento en
  alquileres, no se inventan recordatorios de alquiler.
- Al registrar un pago de factura, alquiler o reintegro, se avisa al otro usuario
  que tenga activados los movimientos. Distingue quién registró de quién pagó.
  No avisa por importaciones, registros anteriores, ediciones ni anulaciones.
- Tocar el aviso abre el mes; la sesión sigue siendo necesaria. El resumen muestra
  hasta tres conceptos y la cantidad restante. La llegada depende de la conexión,
  los permisos y los ajustes del teléfono; no garantiza puntualidad exacta.

### Operación de notificaciones

En desarrollo, `npm run push:setup` crea claves exclusivas en `.private/push.env`,
sin imprimirlas ni sobrescribir `.env.local`. Reiniciá `npm run dev` si ya estaba
abierto y ejecutá `npm run notifications:work` en otra terminal. Para Compose
local usá `docker compose --env-file .env.local --env-file .private/push.env
--profile app up -d web notifications` después del setup de base. Las claves
locales no se copian a producción. Si usás otro puerto, establecé
`BETTER_AUTH_URL=http://localhost:PUERTO` para ese proceso, sin editar credenciales.
Un teléfono necesita HTTPS accesible: el localhost de la laptop no permite
validar instalación y Web Push desde el teléfono.

El proceso independiente revisa pendientes cada minuto. La cola se registra junto
con el movimiento en su transacción; no se envía a proveedores desde el formulario.
Un bloqueo PostgreSQL serializa despachadores; claves únicas impiden duplicados
por evento/dispositivo y resumen/fecha. Los reintentos esperan 2, 4, 8 minutos,
hasta una hora; los movimientos vencen a las 24 horas y los resúmenes al mediodía.
Los endpoints vencidos (404/410) se desactivan. Antes de enviar, revisa saldo,
preferencias y usuario activo. El envío usa el mismo tag al reintentar: una caída
después de que el proveedor acepte el aviso puede repetir la entrega, por lo que
no se promete entrega exactamente una vez. El healthcheck exige un ciclo exitoso
en los últimos cuatro minutos; los logs contienen sólo estado y cantidades.

`GET /api/push` consulta configuración y estado del dispositivo. `POST` registra
su suscripción o solicita una prueba; `PATCH` cambia preferencias y `DELETE`
desactiva. Requieren sesión y las mutaciones verifican Origin y titularidad;
las pruebas se limitan a una por minuto por usuario. Sólo se aceptan endpoints
HTTPS de Apple, Google y Mozilla, no destinos arbitrarios. Suscripciones y claves
nunca se imprimen. `GET /api/auth/get-session` renueva sesiones ordinarias;
las sesiones temporales de operador mantienen su vencimiento corto.

La publicación requiere autorización separada y un backup verificado. En el VPS,
el despliegue aprobado genera las claves nuevas en `vapid.env` privado, junto a
la configuración instalada. El wrapper carga ese archivo sin imprimirlo; si ya
existe, valida y conserva sus claves. También conserva una configuración VAPID
completa existente en `prod.env`; una configuración incompleta detiene el corte.
No copia claves de desarrollo ni cambia credenciales actuales. Better Auth
reutiliza `AUTH_SECRET`/`HOUSE_OPS_SECRET_KEY` y `AUTH_URL`; no exige rotarlas.
Si faltan las claves push, Casa funciona y explica que los avisos no están
configurados. El despliegue detiene el despachador antes del backup y arranca web
y despachador con la misma imagen tras migrar. El rollback recupera Compose e
imagen anteriores sin borrar tablas nuevas ni PDFs; puede requerir nuevo ingreso.
Después de publicar, verificar en ambos teléfonos instalación, reapertura sin
contraseña, aviso de prueba con Casa cerrada y apertura del mes. Las pruebas
automáticas usan datos sintéticos y transporte simulado: no prueban la entrega
real de Apple/Google.

## Cómo se reparten los gastos

- Internet es un gasto personal de Emiliano y queda fuera del reparto. No aparece
  como categoría para cargar ni como servicio pendiente. Los registros anteriores
  se conservan para auditoría, sin sumarlos a las cuentas compartidas.
- TGI también se comparte. Si falta el PDF, se puede cargar el importe y
  vencimiento confirmados por el usuario, un correo o una captura del proveedor.
- Cada factura entra **en el mes de su vencimiento**, aunque el período impreso
  sea anterior. Dos cuotas con vencimientos distintos son dos gastos y pueden
  compartir el mismo PDF. Un segundo vencimiento con recargo es una alternativa,
  no una cuota adicional.
- El importe de las expensas incluye las extraordinarias. Las extraordinarias
  que vencen en un mes descuentan el alquiler del **mes siguiente**. Sin
  extraordinarias no hay descuento. El alquiler se carga explícitamente cada mes:
  la app no inventa un monto a partir de transferencias bancarias.
- El total es alquiler neto + facturas del mes, repartido 50/50. Los cálculos usan
  centavos enteros; si hay un centavo indivisible se asigna a Emiliano.
- Cargar una factura no significa pagarla. Un pago registra fecha, importe y quién
  pagó al proveedor. El reintegro entre los dos se calcula únicamente sobre pagos
  cuyo responsable está confirmado, descontando transferencias ya registradas.
- Anular no borra: los pagos y gastos conservan su historial. Las correcciones
  guardan el antes, el después, el usuario y la fecha en una auditoría inmutable.
- El total muestra sólo lo cargado. La pantalla avisa cuáles servicios todavía
  faltan. Un saldo anterior en una liquidación requiere revisión para no duplicar
  una obligación ya registrada; la app conserva el importe original y su nota.

## Usarla localmente

Requisitos: Node.js 24, npm, Docker Desktop iniciado y un worktree Git aislado.
Desde el worktree, en Windows o Linux:

```sh
npm install
npm run dev:setup
npm run dev
```

Abrí **http://localhost:3000**. Los accesos locales están en
`.private/local-login.txt`. `dev:setup` genera `.env.local`, claves aleatorias,
un puerto exclusivo y un volumen PostgreSQL del worktree. No sobrescribe `.env`
ni configura servicios externos. Repetirlo conserva los usuarios y contraseñas.

También funcionan `scripts/init-worktree.sh` y `scripts/dev-up.sh --full` con Bash.
Los comprobantes viven fuera de la base en `data/shared-documents`, organizados
por SHA-256. Los archivos privados, credenciales y facturas nunca van a Git ni a
la imagen Docker.

## Cargar facturas

Desde **Cargar gasto**, elegí el PDF. Las liquidaciones de expensas compatibles
completan nombre, primer vencimiento, importe y extraordinarias; revisá antes de
guardar. Para otros proveedores, completá los mismos campos manualmente. Se pueden
cargar gastos sin PDF y adjuntar el comprobante después. Una nueva cuota se carga
con su propio vencimiento, usando el mismo PDF.

Codex puede cargar los archivos que le compartas, sin instalar una sincronización
de correo ni enviar las facturas a otro modelo:

```sh
npm run import:pdf -- /ruta/absoluta/expensas.pdf
npm run import:records -- /ruta/privada/registros.json
```

El manifiesto privado admite `expenses` con `title`, `category`, `dueDate` (ISO),
`amount` y `extraordinary` (strings con punto decimal), `notes`, `pdf` (opcional) y
`sourceKey` estable; `rents` admite `month` (`YYYY-MM`) y `gross`. Las importaciones
son repetibles, conservan trazabilidad y no infieren pagos. No subas el manifiesto
ni los PDF al PR. Los importes extraídos de un correo sin PDF quedan como gastos
sin comprobante hasta que se pueda adjuntar el archivo.

`npm run export:handoff` prepara `.private/household-handoff/records.json` y sus
PDF para trasladar las cargas asistidas al VPS después de aprobar el corte. Ese
paquete contiene datos privados, TGI y pagos registrados y se transfiere por separado del PR; nunca entra
a Git ni a la imagen. `node --import tsx scripts/import-handoff.ts records.json`
concilia el paquete sin duplicar fuentes anteriores ni sobrescribir diferencias
financieras. `import:records` resuelve las rutas de los PDF respecto del
manifiesto, para que el paquete se pueda trasladar sin rutas de esta laptop.

## Validación

```sh
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run build
npm audit
docker compose --env-file .env.example config --quiet
docker compose --env-file .env.production.example -f compose.production.yaml config --quiet
git diff --check
```

Para verificar la imagen con una base sintética y sin servicios externos:
`docker build -t house-ops-pwa-local:review .` y luego `npm run test:container`.
La prueba crea y elimina únicamente su base temporal y su contenedor de smoke;
comprueba assets, ingreso, renovación de cookie y arranque del despachador.

Las pruebas de integración y navegador crean bases PostgreSQL locales exclusivas
y las eliminan al terminar. No leen datos del hogar ni producción. El navegador
usa Chrome instalado; en CI se instala Chromium. Para CI:
`E2E_CHANNEL=chromium npm run test:e2e`. El smoke cubre sesión, privacidad, PDF,
descuento al mes siguiente, pago, transferencia, auditoría y ancho móvil.

## Producción y migración

La producción sigue en **https://casa.bordarteuniformes.com.ar**, en el VPS
`bordarte`. Next.js conserva el alias `house-ops-web:8000`, la red de Caddy, el
volumen `home-lab-prod-postgres-data`, la base y el directorio de documentos.
No se cambia DNS ni se publican servicios desde esta laptop.

El PR se verifica y construye una imagen inmutable. **Mergear no despliega esta
migración automáticamente**: el cambio de producción se ejecuta explícitamente
desde `workflow_dispatch`, sólo en `main`, con el entorno `production` y el runner
`vps-production`. El despliegue identifica primero el servicio activo, valida un
backup, detiene los escritores antiguos, crea tablas `shared_*`, importa el
snapshot existente, conserva las contraseñas Django compatibles y recién entonces
arranca Next.js. Si falla, recupera los servicios anteriores sin borrar tablas.
El corte conserva también la raíz de documentos configurada en Django: sus rutas
son relativas a `DOCUMENT_STORE_PATH`, habitualmente `/data/bronze/gmail`, y no
al montaje `/data`. La guarda como `HOUSE_OPS_LEGACY_DOCUMENT_ROOT` para que los
reintentos sigan encontrando los originales sin moverlos.
Un reintento que cambia sólo el operador puede reutilizar mediante `deploy_image`
el digest inmutable de una imagen ya aprobada por CI. La prueba de acceso conserva
la contraseña real del usuario: si ya no coincide con la contraseña de bootstrap
guardada en la instalación, comprueba la sesión temporal sin restablecerla.
Las cargas asistidas transfieren el manifiesto por la entrada del proceso hacia
el `/tmp` privado del contenedor; el filesystem raíz permanece de sólo lectura.

`npm run import:legacy` lee el snapshot Gold/Silver existente y las fuentes Bronze
en la misma base; no ejecuta dbt ni sincronizaciones. Los originales se conservan.
Los pagos antiguos sin responsable verificable quedan pagados pero **sin asignar**:
abrí el gasto, anulá el pago importado y registralo con quien efectivamente pagó.
Los alquileres antiguos sin monto acordado se conservan como evidencia en la
auditoría, pendientes de confirmar. No se reconstruyen como alquileres inventados.

El código Python y los modelos dbt siguen en el repositorio para comparar fuentes
y permitir una recuperación durante el cambio. No se ejecutan ni se incluyen en
el nuevo servidor. Eliminar el archivo histórico es una tarea posterior a validar
el corte y los backups, no una condición para usar la app nueva.

Vercel puede ejecutar Next.js, pero esta entrega apunta al VPS que ya sirve el
dominio y conserva los PDF. Pasar a Vercel requiere elegir almacenamiento privado
durable para comprobantes y una conexión PostgreSQL accesible desde allí; no sirve
escribir PDFs en su filesystem temporal. No se creó una cuenta ni infraestructura
externa para esta migración.

Más detalles: [arquitectura](docs/architecture.md), [datos](docs/data-model.md),
[pantallas](docs/web-app.md), [operación y recuperación](docs/operations.md).
