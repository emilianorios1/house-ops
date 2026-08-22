# Aplicación web

House Ops usa Django templates, Bootstrap 5 y HTMX sólo en acciones donde evita
una navegación completa. No existe build frontend ni estado duplicado en el
navegador.

## Login y navegación

Todas las pantallas salvo `/health/` requieren sesión. Django Authentication
administra los dos usuarios. La barra superior se convierte en offcanvas en
teléfono y ofrece Inicio, Tareas, Rutinas, Ledger, Documentos y Operaciones.

## Home

Home responde “¿qué necesita atención?” y ordena:

1. rutinas vencidas o de hoy;
2. tareas vencidas o de hoy;
3. tareas y rutinas de los próximos siete días;
4. creación rápida de una Task;
5. resumen financiero del mes.

`Hecho` sobre una rutina hace un POST con CSRF y HTMX, reemplaza sólo el panel de
atención y mantiene un botón táctil grande. El flujo inicial es:

```text
Login → Home → Poner veneno para hormigas → Hecho
```

La finalización registra fecha programada, instante, usuario y próximo
vencimiento. Un segundo click/reintento de la misma ocurrencia no duplica historia.

## Tasks

Task contiene título, descripción, estado, prioridad, vencimiento, asignación,
autor y finalización. El Kanban tiene exactamente tres columnas:

```text
Inbox → Doing → Done
```

Los cambios usan botones normales y no drag-and-drop. Completar registra quién lo
hizo; volver a un estado abierto limpia esa atribución. En teléfono las columnas
se apilan verticalmente.

## Routines

Routine acepta cada N días, semanas, meses o años. La lista permite alta, edición,
activar/desactivar, completar lo que está pendiente y consultar historial. No se
materializan ocurrencias futuras.

## Ledger

- Overview: ingresos, egresos, flujo, saldo y resúmenes por día/categoría.
- Movimientos: búsqueda y máximo de filas acotado.
- Obligaciones: importe vigente separado de pagos conciliados.
- Gastos compartidos: servicios, alquiler bruto, extraordinarias, neto y progreso.
- Tarjetas: consumos por moneda/categoría y resúmenes como obligaciones.
- Factura E: historial, límites operator-configured, perfil y emisión sandbox.

Las fórmulas viven en SQL/repositorios, no en templates. Una obligación pendiente
no cambia a pagada por el solo hecho de existir.

## Documentos

La lista filtra por mes, texto, tipo y estado de parser. El detalle muestra
origen, metadata, vencimientos, importe, parser, JSON extraído y preview/descarga
del PDF. La ruta se resuelve dentro del store configurado para impedir escapes; el
archivo nunca se lee desde un blob PostgreSQL.

## Operaciones

Gmail, Mercado Pago, SIAT, `dbt build` e importación CSV se lanzan desde cards
simples. La respuesta web vuelve de inmediato y el estado reciente se actualiza
por HTMX. Los errores entregan mensajes seguros; el detalle técnico queda en logs
sin tokens ni datos financieros.

## Diseño responsive

Los targets principales miden al menos 48 px. Cards y listas reemplazan tablas
cuando mejora lectura móvil; tablas financieras restantes están dentro de
`table-responsive`. Los formularios son cortos, los estados tienen badges y los
empty states explican qué falta.

La prueba Playwright usa viewport 390×844, verifica que no haya overflow
horizontal, ejecuta rutina y Task, navega todas las áreas, y comprueba que carguen
HTMX y estilos Bootstrap.
