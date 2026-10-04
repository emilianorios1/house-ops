import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { ExpenseForm, PaymentForm, VoidForm } from "@/components/forms";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { decimal, money } from "@/lib/money";
export default async function ExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const bill = await db.expense.findUnique({
    where: { id },
    include: { payments: true },
  });
  if (!bill) notFound();
  const month = bill.dueDate.toISOString().slice(0, 7);
  const paid = bill.payments
    .filter((p) => !p.voided)
    .reduce((n, p) => n + p.amountCents, 0n);
  return (
    <Shell name={user.name}>
      <Link className="back" href={`/?month=${month}`}>
        ← Volver al mes
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CADA GASTO, CON SU HISTORIA</span>
          <h1>{bill.title}</h1>
          <p>
            {bill.archived
              ? "Gasto anulado. El comprobante y el historial se conservan."
              : `${money(paid)} pagados · ${money(bill.amountCents - paid)} pendientes`}
          </p>
        </div>
      </div>
      <div className="content-grid">
        <section className="card form-card">
          {!bill.archived && (
            <>
              <ExpenseForm
                initial={{
                  id: bill.id,
                  version: bill.version,
                  title: bill.title,
                  category: bill.category,
                  dueDate: bill.dueDate.toISOString().slice(0, 10),
                  amount: decimal(bill.amountCents),
                  extraordinary: decimal(bill.extraordinaryCents),
                  notes: bill.notes,
                  documentId: bill.documentId ?? undefined,
                }}
              />
              <VoidForm id={bill.id} kind="expense" month={month} />
            </>
          )}
          {bill.archived && bill.documentId && (
            <a
              href={`/api/documents/${bill.documentId}`}
              target="_blank"
              className="text-link"
            >
              Abrir comprobante ↗
            </a>
          )}
        </section>
        <aside className="summary-column">
          {!bill.archived && paid < bill.amountCents && (
            <section className="card form-card">
              <h2>Registrar un pago</h2>
              <p className="help">
                Quién pagó al proveedor y cuánto. Esto actualiza el saldo entre
                ustedes.
              </p>
              <PaymentForm
                expenseId={bill.id}
                amount={decimal(bill.amountCents - paid)}
                payer={user.username}
              />
            </section>
          )}
          <section className="card form-card">
            <h2>Pagos registrados</h2>
            {bill.payments.length ? (
              bill.payments.map((p) => (
                <div key={p.id} className="payment-item">
                  <strong>
                    {money(p.amountCents)} · {p.payer}
                  </strong>
                  <p>
                    {p.paidAt.toISOString().slice(0, 10)}
                    {p.voided ? " · Anulado" : ""}
                  </p>
                  {p.notes && <p>{p.notes}</p>}
                  {!p.voided && (
                    <VoidForm id={p.id} kind="payment" month={month} />
                  )}
                </div>
              ))
            ) : (
              <p className="help">Todavía no registramos pagos.</p>
            )}
          </section>
        </aside>
      </div>
    </Shell>
  );
}
