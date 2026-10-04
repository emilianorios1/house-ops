# Casa · Gastos compartidos

Una app para Emiliano y Vitoria: guardar facturas, ver los gastos de cada mes,
dividirlos por la mitad y saber quién adelantó dinero. Next.js + TypeScript,
PostgreSQL, Prisma, Zod, Auth.js y Tailwind. No requiere Python, Django, dbt,
Gmail, Mercado Pago, un runner de sincronización ni un proveedor de IA para funcionar.

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
