import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { decimal } from "@/lib/money";
function cell(v: string) {
  const safe = /^[=+@\-\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}
export async function GET() {
  if (!(await currentUser()))
    return new Response("Iniciá sesión.", { status: 401 });
  const expenses = await db.expense.findMany({
    include: { document: true },
    orderBy: { dueDate: "desc" },
  });
  const rows = [
    [
      "ID",
      "Gasto",
      "Categoría",
      "Vencimiento",
      "Importe ARS",
      "Extraordinarias ARS",
      "Anulado",
      "Comprobante",
      "Notas",
    ],
    ...expenses.map((e) => [
      e.id,
      e.title,
      e.category,
      e.dueDate.toISOString().slice(0, 10),
      decimal(e.amountCents),
      decimal(e.extraordinaryCents),
      e.archived ? "Sí" : "No",
      e.document?.filename ?? "",
      e.notes,
    ]),
  ];
  return new Response(
    "\uFEFF" + rows.map((r) => r.map(cell).join(";")).join("\r\n"),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="gastos-casa.csv"',
        "Cache-Control": "private, no-store",
      },
    },
  );
}
