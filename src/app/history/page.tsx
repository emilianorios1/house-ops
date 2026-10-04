import Link from "next/link";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { getMonth } from "@/lib/month";
import { money, monthLabel } from "@/lib/money";
export default async function HistoryPage() {
  const user = await requireUser();
  const [bills, rents] = await Promise.all([
    db.expense.findMany({
      where: { archived: false, category: { not: "Internet" } },
      select: { dueDate: true },
    }),
    db.rent.findMany({ select: { month: true } }),
  ]);
  const months = [
    ...new Set([
      ...bills.map((b) => b.dueDate.toISOString().slice(0, 7)),
      ...rents.map((r) => r.month),
    ]),
  ]
    .sort()
    .reverse();
  const rows = await Promise.all(months.map(getMonth));
  return (
    <Shell name={user.name} active="history">
      <div className="page-heading">
        <div>
          <span className="eyebrow">LO QUE FUIMOS COMPARTIENDO</span>
          <h1>Nuestras cuentas, mes a mes</h1>
          <p>Cada factura en su mes de vencimiento. Todo queda guardado.</p>
        </div>
        <a className="button secondary" href="/api/export">
          Exportar gastos CSV ↗
        </a>
      </div>
      {rows.length ? (
        <div className="history-grid">
          {rows.map(({ month, bills, rent, summary: s }) => (
            <section className="card history-card" key={month}>
              <h2>{monthLabel(month)}</h2>
              <strong>{money(s.total)}</strong>
              <p>
                Emiliano: {money(s.emilianoShare)}
                <br />
                Vitoria: {money(s.vitoriaShare)}
              </p>
              <p style={{ marginTop: 12 }}>
                {bills.length} gastos ·{" "}
                {rent ? "Alquiler cargado" : "Falta alquiler"}
                <br />
                {money(s.pending)} pendientes
              </p>
              <Link className="text-link" href={`/?month=${month}`}>
                Abrir este mes ↗
              </Link>
            </section>
          ))}
        </div>
      ) : (
        <section className="card empty">
          <strong>El historial empieza con el primer gasto.</strong>
          <Link className="button primary" href="/expenses/new">
            Cargar gasto
          </Link>
        </section>
      )}
    </Shell>
  );
}
