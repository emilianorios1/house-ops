import Link from "next/link";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
const labels: Record<string, string> = {
  "expense.create": "cargó un gasto",
  "expense.update": "corrigió un gasto",
  "expense.void": "anuló un gasto",
  "rent.save": "guardó el alquiler",
  "payment.create": "registró un pago",
  "payment.void": "anuló un pago",
  "settlement.create": "registró una transferencia",
  "settlement.void": "anuló una transferencia",
  "document.upload": "subió un comprobante",
  "legacy.import": "importó un registro anterior",
};
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireUser();
  const { page = "1" } = await searchParams;
  const current = Math.max(1, Math.min(100000, Number(page) || 1));
  const events = await db.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    skip: (current - 1) * 50,
  });
  return (
    <Shell name={user.name} active="audit">
      <div className="page-heading">
        <div>
          <span className="eyebrow">NADA SE PIERDE</span>
          <h1>La historia de cada cambio</h1>
          <p>Quién hizo qué, cuándo y cómo estaban los datos antes.</p>
        </div>
      </div>
      <section className="card">
        {events.map((e) => (
          <article key={e.id} className="audit-row">
            <div>
              <strong>
                {e.actor} {labels[e.action] ?? e.action}
              </strong>
              <time>
                {e.createdAt.toLocaleString("es-AR", {
                  timeZone: "America/Argentina/Buenos_Aires",
                })}
              </time>
            </div>
            <p>
              {e.entity === "rent"
                ? `Alquiler de ${e.entityId}`
                : `Registro ${e.entityId}`}
            </p>
            <details>
              <summary>Ver detalle del cambio</summary>
              <pre>
                {JSON.stringify({ antes: e.before, después: e.after }, null, 2)}
              </pre>
            </details>
          </article>
        ))}
        {!events.length && (
          <div className="empty">Cada cambio aparecerá acá.</div>
        )}
      </section>
      <div className="month-bar" style={{ marginTop: 20 }}>
        {current > 1 && (
          <Link href={`/audit?page=${current - 1}`}>← Anterior</Link>
        )}
        {events.length === 50 && (
          <Link href={`/audit?page=${current + 1}`}>Siguiente →</Link>
        )}
      </div>
    </Shell>
  );
}
