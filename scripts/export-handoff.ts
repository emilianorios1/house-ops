import { config } from "dotenv";
config({
  path: ".env.local",
  quiet: true,
  override: !process.env.HOUSE_OPS_DATABASE_OVERRIDE,
});
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/lib/db";
import { decimal } from "../src/lib/money";
async function main() {
  // This private bundle is explicitly separate from the code PR and container.
  const root = resolve(".private/household-handoff");
  await mkdir(resolve(root, "documents"), { recursive: true });
  const expenses = await db.expense.findMany({
    where: {
      archived: false,
      OR: [
        { sourceKey: { startsWith: "pdf:" } },
        { sourceKey: { startsWith: "email:" } },
        { sourceKey: { startsWith: "household:" } },
      ],
    },
    include: { document: true, payments: { where: { voided: false } } },
    orderBy: { dueDate: "asc" },
  });
  const records = [];
  for (const e of expenses) {
    let pdf: string | undefined;
    if (e.document) {
      pdf = `documents/${e.document.sha256}.pdf`;
      await copyFile(
        resolve(
          process.env.DOCUMENT_STORE_PATH ?? "data/shared-documents",
          e.document.storageKey,
        ),
        resolve(root, pdf),
      );
    }
    records.push({
      title: e.title,
      category: e.category,
      dueDate: e.dueDate.toISOString().slice(0, 10),
      amount: decimal(e.amountCents),
      extraordinary: decimal(e.extraordinaryCents),
      notes: e.notes,
      sourceKey: e.sourceKey,
      pdf,
      sha256: e.document?.sha256,
    });
  }
  const rents = await db.rent.findMany({
    where: { month: { lt: "2090-01" } },
    orderBy: { month: "asc" },
    include: { payments: { where: { voided: false } } },
  });
  const payments = [
    ...expenses.flatMap((e) =>
      e.payments.map((p) => ({
        expenseSourceKey: e.sourceKey,
        payer: p.payer,
        amount: decimal(p.amountCents),
        paidAt: p.paidAt.toISOString().slice(0, 10),
        notes: p.notes,
        sourceKey: p.sourceKey ?? `handoff:payment:${p.id}`,
      })),
    ),
    ...rents.flatMap((r) =>
      r.payments.map((p) => ({
        rentMonth: r.month,
        payer: p.payer,
        amount: decimal(p.amountCents),
        paidAt: p.paidAt.toISOString().slice(0, 10),
        notes: p.notes,
        sourceKey: p.sourceKey ?? `handoff:payment:${p.id}`,
      })),
    ),
  ];
  const settlements = await db.settlement.findMany({
    where: { voided: false, month: { lt: "2090-01" } },
    orderBy: { createdAt: "asc" },
  });
  await writeFile(
    resolve(root, "records.json"),
    JSON.stringify(
      {
        expenses: records,
        rents: rents.map((r) => ({
          month: r.month,
          gross: decimal(r.grossCents),
          creditOverride:
            r.creditOverrideCents === null
              ? null
              : decimal(r.creditOverrideCents),
          creditReason: r.creditReason,
        })),
        payments,
        settlements: settlements.map((s) => ({
          sourceKey: `handoff:settlement:${s.id}`,
          month: s.month,
          from: s.from,
          amount: decimal(s.amountCents),
          paidAt: s.paidAt.toISOString().slice(0, 10),
          notes: s.notes,
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    `Private handoff ready: ${records.length} obligations, ${rents.length} agreed rents, ${payments.length} recorded payments and ${settlements.length} transfers. No credentials or inferred payments included; never commit this directory.`,
  );
}
main().finally(() => db.$disconnect());
