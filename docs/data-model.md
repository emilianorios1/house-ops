# Datos

Las tablas nuevas están en `public`, con prefijo `shared_`, sin colisionar con
Django, Bronze, Silver o Gold.

| Modelo       | Qué conserva                                                                          |
| ------------ | ------------------------------------------------------------------------------------- |
| User         | usuario del hogar, nombre, hash de contraseña y estado activo                         |
| Document     | hash SHA-256 único, nombre original, tamaño, ruta relativa y origen                   |
| Expense      | nombre, categoría, vencimiento, centavos, extraordinarias, notas, versión y anulación |
| Rent         | mes, monto acordado, descuento manual opcional con motivo y versión                   |
| Payment      | importe, fecha, responsable y una obligación (gasto o alquiler)                       |
| Settlement   | transferencia entre los dos para un mes, fecha, notas y anulación                     |
| AuditEvent   | actor, acción, registro afectado, valores anteriores/nuevos y fecha                   |
| LoginAttempt | contador temporal para limitar intentos de ingreso                                    |

Un pago tiene exactamente un gasto o un alquiler asociado. No se trata una
obligación como un pago. El esquema verifica importes positivos, categorías,
responsables y extraordinarias menores o iguales al total. Sólo las expensas
pueden tener extraordinarias. El mismo PDF y vencimiento no pueden duplicar un
gasto activo; distintas cuotas sí pueden compartir el PDF.

Las extraordinarias se aplican al alquiler siguiente según **vencimiento**. Una
corrección que dejaría el alquiler siguiente por debajo de pagos ya registrados se
rechaza para que se revisen esos pagos. Un descuento mayor que el alquiler se
muestra como diferencia a resolver; no se pierde ni se arrastra silenciosamente.

Los importadores usan claves de origen únicas. Un pago histórico sin responsable
queda `unassigned`: afecta el pendiente del proveedor, pero no se atribuye un
adelanto. Las evidencias históricas que no pueden convertirse sin inventar datos
quedan en auditoría para confirmar. El baseline Prisma no altera tablas antiguas.
