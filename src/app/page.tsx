import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  ArrowUpRight,
  Home,
  Receipt,
  Check,
  ArrowLeftRight,
  Info,
  Lightbulb,
  Flame,
  Droplets,
  Landmark,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/session";
import { getMonth } from "@/lib/month";
import { money, monthLabel, monthSchema, shiftMonth, today } from "@/lib/money";
const icons: Record<string, typeof Receipt> = {
  Expensas: Receipt,
  Luz: Lightbulb,
  Agua: Droplets,
  Gas: Flame,
  TGI: Landmark,
};
export default async function MonthPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; saved?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const parsed = monthSchema.safeParse(params.month);
  const month = parsed.success ? parsed.data : today().slice(0, 7);
  const { bills, previousBills, rent, summary: s } = await getMonth(month);
  const paidRent =
    rent?.payments
      .filter((p) => !p.voided)
      .reduce((n, p) => n + p.amountCents, 0n) ?? 0n;
  const hasMissing = ["Expensas", "Luz", "Agua", "Gas", "TGI"].filter(
    (c) => !bills.some((b) => b.category === c),
  );
  const who =
    s.reimbursement >= 0n
      ? "Vitoria le transfiere a Emiliano"
      : "Emiliano le transfiere a Vitoria";
  const transfer = s.reimbursement < 0n ? -s.reimbursement : s.reimbursement;
  return (
    <Shell name={user.name}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">NUESTRA CASA, EN ORDEN</span>
          <h1>
            Un mes, cuentas claras<span className="teal">.</span>
          </h1>
          <p>Todo lo que compartimos, dividido entre los dos.</p>
        </div>
        <Link className="button primary" href={`/expenses/new?month=${month}`}>
          <Plus size={18} />
          Cargar gasto
        </Link>
      </div>
      <div className="month-bar">
        <div className="month-select">
          <Link
            aria-label="Mes anterior"
            href={`/?month=${shiftMonth(month, -1)}`}
          >
            <ChevronLeft size={18} />
          </Link>
          <h2>{monthLabel(month)}</h2>
          <Link
            aria-label="Mes siguiente"
            href={`/?month=${shiftMonth(month, 1)}`}
          >
            <ChevronRight size={18} />
          </Link>
        </div>
        <span className="pill">
          <span className="dot" />
          Reparto 50 / 50
        </span>
      </div>
      {params.saved && (
        <div className="notice" role="status">
          <Check size={18} />
          Guardado. El reparto y el historial ya están actualizados.
        </div>
      )}
      {s.unassignedPaid > 0n && (
        <div className="notice">
          Hay {money(s.unassignedPaid)} de pagos del sistema anterior sin
          responsable confirmado. Se conservan como pagados, pero no calculamos
          adelantos con ellos. Abrí cada gasto para confirmar quién pagó.
        </div>
      )}
      {s.paid > s.total && (
        <div className="notice">
          Los pagos importados superan el total recalculado. Revisá el historial
          antes de registrar transferencias.
        </div>
      )}
      <div className="stat-grid">
        <section className="stat-card">
          <span className="stat-label">
            TOTAL DEL MES <Receipt size={18} />
          </span>
          <strong>{money(s.total)}</strong>
          <span>
            {bills.length} {bills.length === 1 ? "gasto" : "gastos"} +{" "}
            {rent ? "alquiler" : "alquiler sin cargar"}
          </span>
        </section>
        <section className="stat-card personal">
          <span className="stat-label">
            A CADA UNO LE TOCA <ArrowLeftRight size={18} />
          </span>
          <strong>{money(s.vitoriaShare)}</strong>
          <span>
            Emiliano {money(s.emilianoShare)} · Vitoria {money(s.vitoriaShare)}
          </span>
          <div className="stat-orbit" />
        </section>
        <section className="stat-card">
          <span className="stat-label">
            PENDIENTE DE PAGAR <ClockIcon />
          </span>
          <strong>{money(s.pending)}</strong>
          <span>{money(s.paid)} pagados a proveedores</span>
          <div className="progress">
            <span
              style={{
                width: `${s.total ? Math.min(100, Number((s.paid * 100n) / s.total)) : 0}%`,
              }}
            />
          </div>
        </section>
      </div>
      <div className="content-grid">
        <section className="card expenses-card">
          <div className="section-heading">
            <div>
              <h2>Los gastos de {monthLabel(month).split(" ")[0]}</h2>
              <p>Según el vencimiento de cada factura.</p>
            </div>
            <span className="count">{bills.length + (rent ? 1 : 0)}</span>
          </div>
          <div className="expense-list">
            <Link className="expense-row" href={`/rent/${month}`}>
              <span className="expense-icon rent">
                <Home size={21} />
              </span>
              <div className="expense-title">
                <strong>Alquiler</strong>
                <span>
                  {rent
                    ? `Acordado ${money(s.gross)}${s.credit ? ` · descuento ${money(s.credit)}` : ""}`
                    : "Falta cargar el alquiler de este mes"}
                </span>
              </div>
              <span className="expense-amount">
                <strong>{rent ? money(s.net) : "Sin cargar"}</strong>
                <span
                  className={`status ${rent && paidRent >= s.net ? "paid" : "pending"}`}
                >
                  {rent
                    ? paidRent >= s.net
                      ? "Pagado"
                      : "Pendiente"
                    : "Completar"}
                </span>
              </span>
              <ChevronRight size={17} />
            </Link>
            {bills.map((b) => {
              const Icon = icons[b.category] ?? Receipt;
              const paid = b.payments
                .filter((p) => !p.voided)
                .reduce((n, p) => n + p.amountCents, 0n);
              return (
                <Link
                  key={b.id}
                  className="expense-row"
                  href={`/expenses/${b.id}`}
                >
                  <span
                    className={`expense-icon ${b.category === "Expensas" ? "violet" : ""}`}
                  >
                    <Icon size={21} />
                  </span>
                  <div className="expense-title">
                    <strong>{b.title}</strong>
                    <span>
                      Vence{" "}
                      {new Intl.DateTimeFormat("es-AR", {
                        day: "numeric",
                        month: "short",
                        timeZone: "UTC",
                      }).format(b.dueDate)}
                      {b.document ? " · Con comprobante" : " · Sin comprobante"}
                    </span>
                  </div>
                  <span className="expense-amount">
                    <strong>{money(b.amountCents)}</strong>
                    <span
                      className={`status ${paid >= b.amountCents ? "paid" : "pending"}`}
                    >
                      {paid >= b.amountCents
                        ? "Pagado"
                        : paid
                          ? "Pago parcial"
                          : "Pendiente"}
                    </span>
                  </span>
                  <ChevronRight size={17} />
                </Link>
              );
            })}
            {!bills.length && (
              <div className="empty">
                <Receipt size={28} />
                <strong>Hay lugar para lo que viene.</strong>
                <span>Cargá las facturas que vencen este mes.</span>
              </div>
            )}
          </div>
          <Link href={`/expenses/new?month=${month}`} className="add-row">
            <Plus size={16} />
            Agregar un gasto
          </Link>
        </section>
        <aside className="summary-column">
          <section className="card split-card">
            <span className="eyebrow">MITAD Y MITAD</span>
            <h2>Así nos repartimos</h2>
            <div className="person-row">
              <span className="avatar">E</span>
              <div>
                <strong>Emiliano</strong>
                <span>50% del mes</span>
              </div>
              <strong>{money(s.emilianoShare)}</strong>
            </div>
            <div className="person-row">
              <span className="avatar coral">V</span>
              <div>
                <strong>Vitoria</strong>
                <span>50% del mes</span>
              </div>
              <strong>{money(s.vitoriaShare)}</strong>
            </div>
            <div className="balance">
              <span>Entre nosotros</span>
              <strong>{transfer ? who : "Estamos a mano por lo pagado"}</strong>
              <b>{money(transfer)}</b>
              <p>
                Calculado sobre pagos registrados y transferencias entre los
                dos.
              </p>
              <Link className="button secondary" href={`/settlements/${month}`}>
                Registrar transferencia
                <ArrowUpRight size={15} />
              </Link>
            </div>
          </section>
          <section className="rent-note">
            <span className="note-icon">
              <Info size={18} />
            </span>
            <h3>Las extraordinarias vuelven</h3>
            <p>
              {s.credit ? (
                <>
                  Las expensas extraordinarias de{" "}
                  {monthLabel(shiftMonth(month, -1))} descuentan{" "}
                  <strong>{money(s.credit)}</strong> del alquiler de este mes.
                </>
              ) : (
                "Si hay extraordinarias en las expensas, las descontamos del alquiler del mes siguiente."
              )}
            </p>
            {previousBills.map(
              (b) =>
                b.document && (
                  <a
                    key={b.id}
                    target="_blank"
                    href={`/api/documents/${b.document.id}`}
                    className="text-link"
                  >
                    Ver liquidación anterior ↗
                  </a>
                ),
            )}
            {s.unusedCredit > 0n && (
              <p className="form-error">
                El descuento supera el alquiler en {money(s.unusedCredit)}.
                Revisen cómo compensar esa diferencia; no se arrastra
                automáticamente.
              </p>
            )}
          </section>
        </aside>
      </div>
      {hasMissing.length > 0 && (
        <div className="missing-note">
          <Info size={16} />
          <p>
            Este mes todavía no cargamos:{" "}
            <strong>{hasMissing.join(", ")}</strong>. El total muestra
            únicamente los gastos guardados.
          </p>
        </div>
      )}
    </Shell>
  );
}
function ClockIcon() {
  return <span style={{ fontSize: 19 }}>◷</span>;
}
