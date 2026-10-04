import Link from "next/link";
import { Shell } from "@/components/shell";
import { ExpenseForm } from "@/components/forms";
import { requireUser } from "@/lib/session";
import { monthSchema, today } from "@/lib/money";
export default async function NewExpense({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const month = monthSchema.safeParse(params.month);
  return (
    <Shell name={user.name}>
      <Link className="back" href="/">
        ← Volver al mes
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">UN GASTO MÁS, TODO EN ORDEN</span>
          <h1>Cargar gasto</h1>
          <p>Subí el comprobante y guardá los datos para repartirlo.</p>
        </div>
      </div>
      <section className="card form-card">
        <ExpenseForm
          initial={{
            title: "",
            category: "Expensas",
            dueDate: month.success ? `${month.data}-01` : today(),
            amount: "",
            extraordinary: "0",
            notes: "",
          }}
        />
      </section>
    </Shell>
  );
}
