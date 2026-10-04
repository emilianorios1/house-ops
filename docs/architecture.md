# Arquitectura

Un monolito Next.js App Router con componentes de servidor y Server Actions.
Prisma accede directamente a PostgreSQL; no hay capas Bronze/Silver/Gold en el
flujo nuevo. `src/lib/calculation.ts` concentra las reglas de reparto, usando
`bigint` para no perder centavos. Zod valida importes, fechas y formularios.

Auth.js usa sesiones JWT y sólo dos usuarios activos. Las acciones y todos los
endpoints de datos verifican la sesión contra PostgreSQL. Las contraseñas nuevas
usan scrypt; el importador conserva hashes Django PBKDF2-SHA256. Los intentos de
ingreso se limitan por usuario en la base, sin depender de memoria de una instancia.

Los PDF se validan, se almacenan por hash fuera de la base y se sirven sólo por una
ruta autenticada que vuelve a verificar su integridad. No se aceptan URLs de
descarga en formularios: la app no es un proxy para sitios arbitrarios ni ejecuta
instrucciones dentro de las facturas. La lectura compatible de expensas sólo
propone campos que la persona confirma al guardar.

Las escrituras monetarias y sus eventos de auditoría comparten una transacción.
Versiones optimistas evitan pisar ediciones; las operaciones sensibles al saldo
usan aislamiento Serializable. Anular conserva los registros. PostgreSQL impide
modificar o borrar eventos de auditoría mediante un trigger append-only.

El importador de corte lee únicamente gastos compartidos del snapshot anterior.
Las tablas anteriores y los PDF originales quedan conservados para recuperación;
el runtime nuevo no vuelve a consultarlos. No hay un runner ni llamadas de Gmail,
Mercado Pago, SIAT o modelos de IA en el despliegue nuevo.
