import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import Link from "next/link";
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const user = await requireUser();
  const { q = "", page = "1" } = await searchParams;
  const current = Math.max(1, Math.min(100000, Number(page) || 1));
  const docs = await db.document.findMany({
    where: q
      ? { filename: { contains: q.slice(0, 100), mode: "insensitive" } }
      : {},
    include: {
      expenses: {
        select: { id: true, title: true, dueDate: true, archived: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    skip: (current - 1) * 50,
  });
  return (
    <Shell name={user.name} active="documents">
      <div className="page-heading">
        <div>
          <span className="eyebrow">LA MEMORIA DE NUESTRA CASA</span>
          <h1>Comprobantes</h1>
          <p>Las facturas originales, siempre a mano.</p>
        </div>
        <Link className="button primary" href="/expenses/new">
          Subir factura
        </Link>
      </div>
      <form className="filters">
        <label>
          Buscar por nombre
          <input name="q" defaultValue={q} placeholder="Expensas, factura…" />
        </label>
        <button className="button secondary">Buscar</button>
      </form>
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Comprobante</th>
              <th>Gastos asociados</th>
              <th>Archivo</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.filename}
                  <small>
                    {d.createdAt.toLocaleDateString("es-AR", {
                      timeZone: "America/Argentina/Buenos_Aires",
                    })}{" "}
                    · {(d.byteSize / 1024).toFixed(0)} KB
                  </small>
                </td>
                <td>
                  {d.expenses.length ? (
                    d.expenses.map((e) => (
                      <Link
                        key={e.id}
                        href={`/expenses/${e.id}`}
                        className="text-link"
                      >
                        {e.title} · {e.dueDate.toISOString().slice(0, 7)}
                        {e.archived ? " (anulado)" : ""}
                        <br />
                      </Link>
                    ))
                  ) : (
                    <small>Sin gasto asociado todavía</small>
                  )}
                </td>
                <td>
                  <a
                    className="text-link"
                    href={`/api/documents/${d.id}`}
                    target="_blank"
                  >
                    Ver PDF ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!docs.length && (
          <div className="empty">No encontramos comprobantes.</div>
        )}
      </section>
      <div className="month-bar" style={{ marginTop: 20 }}>
        {current > 1 && (
          <Link
            href={`/documents?q=${encodeURIComponent(q)}&page=${current - 1}`}
          >
            ← Anterior
          </Link>
        )}
        {docs.length === 50 && (
          <Link
            href={`/documents?q=${encodeURIComponent(q)}&page=${current + 1}`}
          >
            Siguiente →
          </Link>
        )}
      </div>
    </Shell>
  );
}
