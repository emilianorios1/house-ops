import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { RentForm, PaymentForm, VoidForm } from "@/components/forms";
import { requireUser } from "@/lib/session";
import { getMonth } from "@/lib/month";
import { decimal, money, monthLabel, monthSchema } from "@/lib/money";
export default async function RentPage({
  params,
}: {
  params: Promise<{ month: string }>;
}) {
  const user = await requireUser();
  const { month } = await params;
  if (!monthSchema.safeParse(month).success) notFound();
  const { rent, summary: s } = await getMonth(month);
  const paid =
    rent?.payments
      .filter((p) => !p.voided)
      .reduce((n, p) => n + p.amountCents, 0n) ?? 0n;
  return (
    <Shell name={user.name}>
      <Link className="back" href={`/?month=${month}`}>
        ← Volver al mes
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">EL ALQUILER, SIN VUELTAS</span>
          <h1>Alquiler de {monthLabel(month)}</h1>
          <p>El monto acordado menos las extraordinarias del mes anterior.</p>
        </div>
      </div>
      <div className="content-grid">
        <section className="card form-card">
          <div className="rent-breakdown">
            <span>
              Acordado <b>{money(s.gross)}</b>
            </span>
            <span>
              Descuento <b>− {money(s.credit)}</b>
            </span>
            <strong>
              A la inmobiliaria <b>{money(s.net)}</b>
            </strong>
          </div>
          <RentForm
            month={month}
            gross={rent ? decimal(rent.grossCents) : ""}
            credit={
              rent?.creditOverrideCents != null
                ? decimal(rent.creditOverrideCents)
                : ""
            }
            reason={rent?.creditReason ?? ""}
            version={rent?.version ?? 0}
          />
        </section>
        <aside className="summary-column">
          {rent && paid < s.net && (
            <section className="card form-card">
              <h2>Registrar un pago</h2>
              <PaymentForm
                rentMonth={month}
                amount={decimal(s.net - paid)}
                payer={user.username}
              />
            </section>
          )}
          <section className="card form-card">
            <h2>Pagos del alquiler</h2>
            {rent?.payments.length ? (
              rent.payments.map((p) => (
                <div key={p.id} className="payment-item">
                  <strong>
                    {money(p.amountCents)} · {p.payer}
                  </strong>
                  <p>
                    {p.paidAt.toISOString().slice(0, 10)}
                    {p.voided ? " · Anulado" : ""}
                  </p>
                  {!p.voided && (
                    <VoidForm id={p.id} kind="payment" month={month} />
                  )}
                </div>
              ))
            ) : (
              <p className="help">Sin pagos registrados.</p>
            )}
          </section>
        </aside>
      </div>
    </Shell>
  );
}
