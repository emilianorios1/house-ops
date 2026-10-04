import { db } from "./db";
import { monthSchema, shiftMonth } from "./money";
import { calculateMonth } from "./calculation";
export async function getMonth(month: string) {
  monthSchema.parse(month);
  const previous = shiftMonth(month, -1);
  const end = shiftMonth(month, 1);
  const [bills, previousBills, rent, settlements] = await Promise.all([
    db.expense.findMany({
      where: {
        archived: false,
        category: { not: "Internet" },
        dueDate: { gte: new Date(`${month}-01`), lt: new Date(`${end}-01`) },
      },
      include: { document: true, payments: true },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    }),
    db.expense.findMany({
      where: {
        archived: false,
        dueDate: {
          gte: new Date(`${previous}-01`),
          lt: new Date(`${month}-01`),
        },
        extraordinaryCents: { gt: 0 },
      },
      include: { document: true },
    }),
    db.rent.findUnique({ where: { month }, include: { payments: true } }),
    db.settlement.findMany({ where: { month }, orderBy: { paidAt: "desc" } }),
  ]);
  return {
    month,
    bills,
    previousBills,
    rent,
    settlements,
    summary: calculateMonth(bills, previousBills, rent, settlements),
  };
}
