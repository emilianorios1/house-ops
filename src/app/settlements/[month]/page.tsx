import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { SettlementForm, VoidForm } from "@/components/forms";
import { requireUser } from "@/lib/session";
import { getMonth } from "@/lib/month";
import { decimal, money, monthLabel, monthSchema } from "@/lib/money";
export default async function SettlementPage({
  params,
}: {
  params: Promise<{ month: string }>;
}) {
  const user = await requireUser();
  const { month } = await params;
  if (!monthSchema.safeParse(month).success) notFound();
  const { settlements, summary: s } = await getMonth(month);
  return (
    <Shell name={user.name}>
      <Link className="back" href={`/?month=${month}`}>
        ← Volver al mes
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ENTRE NOSOTROS</span>
          <h1>Transferencias de {monthLabel(month)}</h1>
          <p>Dejá registrado lo que uno le devuelve al otro.</p>
        </div>
      </div>
      <div className="content-grid">
        <section className="card form-card">
          <SettlementForm
            month={month}
            amount={decimal(
              s.reimbursement < 0n ? -s.reimbursement : s.reimbursement,
            )}
            from={s.reimbursement >= 0n ? "vitoria" : "emiliano"}
          />
        </section>
        <section className="card form-card">
          <h2>Transferencias registradas</h2>
          {settlements.length ? (
            settlements.map((t) => (
              <div key={t.id} className="payment-item">
                <strong>
                  {money(t.amountCents)} ·{" "}
                  {t.from === "vitoria"
                    ? "Vitoria → Emiliano"
                    : "Emiliano → Vitoria"}
                </strong>
                <p>
                  {t.paidAt.toISOString().slice(0, 10)}
                  {t.voided ? " · Anulada" : ""}
                </p>
                {t.notes && <p>{t.notes}</p>}
                {!t.voided && (
                  <VoidForm id={t.id} kind="settlement" month={month} />
                )}
              </div>
            ))
          ) : (
            <p className="help">Todavía no registramos transferencias.</p>
          )}
        </section>
      </div>
    </Shell>
  );
}
