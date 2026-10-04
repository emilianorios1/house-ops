# Operación y recuperación

## Desarrollo

En un worktree aislado: `npm install`, `npm run dev:setup`, `npm run dev`.
La app está en http://localhost:3000 y el acceso local en
`.private/local-login.txt`. Se usa `.env.local`, sin sobrescribir `.env`.
Los PDF están en `data/shared-documents`, excluidos de Git y Docker.

## Corte en el VPS existente

1. Validar el PR y confirmar el snapshot existente en `bordarte`, el contenedor
   web, la imagen activa, Caddy y el alias `house-ops-web:8000`.
2. Revisar que el propietario configurado de `/data` pueda escribir en
   `shared-documents` y leer los PDF anteriores. No cambiar credenciales, DNS ni
   permisos de sudo; se conserva la regla limitada al script de deploy.
3. Ejecutar explícitamente CI/CD desde `main` con `workflow_dispatch` y aprobación
   del entorno `production`. El merge por sí solo publica la imagen, no despliega.
4. El script toma un backup PostgreSQL y comprueba su restauración en un contenedor
   temporal aislado; detiene Django y el sync-runner durante el corte para que el
   snapshot de gastos compartidos no cambie mientras se importa.
5. La migración crea un baseline si hay Django y luego sólo tablas nuevas. El
   importador copia los PDF con hash verificado, gastos, alquileres configurados,
   pagos históricos y los dos usuarios. No transforma Gold ni llama servicios.
6. Si faltan fuentes, PDF, integridad o soporte del hash de una contraseña, el
   proceso se detiene. No se reemplaza una aplicación con una base vacía. Las
   filas ya importadas permiten reintentar sin duplicación.
7. Next.js usa la misma base, volumen, puerto 8000, alias y red frontal. El health
   local comprueba PostgreSQL y el smoke público comprueba el dominio canónico.

Las facturas nuevas cargadas sólo en desarrollo no viajan en el PR. El paquete
privado generado con `npm run export:handoff` debe transferirse por un canal seguro
al VPS e importarse con `node --import tsx scripts/import-handoff.ts /ruta/privada/records.json`
después del corte, con autorización explícita. No contiene credenciales; no se
infieren pagos: se trasladan los que ya están registrados, sin atribuir los pagos
de responsable desconocido. El importador verifica hashes, concilia fuentes antiguas,
rechaza diferencias financieras sin reescribirlas y admite reintentos sin duplicación.
Confirmar el resultado en el dominio público y preservar el paquete
hasta verificar las facturas en el nuevo almacenamiento.

El workflow manual usa `operation=preflight` para diagnóstico de lectura y
`operation=deploy` para un corte autorizado. Para trasladar datos en ese corte,
se puede comprimir el paquete, dividir su base64 en secretos temporales
`HOUSE_OPS_HANDOFF_01` a `HOUSE_OPS_HANDOFF_20` (hasta 40.000 caracteres por parte)
y proporcionar `handoff_sha256` del archivo comprimido. La recepción verifica
hash, tamaños y rutas antes de extraer. Los contenidos nunca aparecen en Git ni
logs; los temporales del runner y del contenedor se retiran al terminar. El operador
debe retirar también esos secretos de GitHub después de verificar la importación.
No incluir credenciales en el paquete. Las credenciales originales del VPS siguen
vigentes; el smoke comprueba ingreso con ellas y los PDFs autenticados del dominio.

Si falla durante el corte, el trap devuelve la configuración y la imagen previas
y reinicia los servicios anteriores. La migración no borra las tablas originales,
por lo que el rollback de aplicación no requiere restaurar o reescribir la base.

Se conservan `deployment.previous.env` y `compose.production.previous.yaml` para
un rollback de operador. **Después de aceptar escrituras en Next.js**, volver a
Django exige revisar los cambios nuevos: sus tablas no reciben esas escrituras.
Nunca restaurar un backup antiguo automáticamente sobre datos recientes.

## Backups

El backup PostgreSQL existente sigue incluyendo los esquemas antiguos y nuevos.
La copia del directorio de documentos debe incluir `/data/shared-documents`
además de los PDF anteriores: una base sin los archivos no es una recuperación
completa. `verify-production-backup.sh` verifica la base, no los archivos externos.
El corte congela los escritores y agrega una copia `.documents.tar.gz`, comparada
con los documentos originales y verificada por SHA-256, junto al backup de la base.
Antes del corte debe estar verificada también la copia duradera del directorio
de documentos. El PR no cambia ni borra backups ni crea una sincronización externa.

## Vercel

No se movió el dominio ni la infraestructura a Vercel. La app es Next.js, pero el
filesystem serverless no es un depósito persistente de facturas. Una migración a
Vercel debe sustituir el adaptador de archivos por almacenamiento privado durable,
aprobar la conectividad de PostgreSQL y probar backups y acceso autenticado antes
de cambiar el DNS. El VPS actual evita esa dependencia adicional.

## Archivo histórico

Los módulos Python, Django, dbt y sus tests se conservan como archivo de la fuente
anterior. No entran al Dockerfile ni a los comandos nuevos de desarrollo y deploy.
Los documentos de integraciones anteriores son referencia histórica, no pasos
necesarios para usar la app nueva. No ejecutar autenticaciones ni sincronizaciones
antiguas como parte de esta migración.
