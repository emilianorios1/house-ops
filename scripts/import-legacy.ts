import { config } from "dotenv";
config({
  path: ".env.local",
  quiet: true,
  override: !process.env.HOUSE_OPS_DATABASE_OVERRIDE,
});
import { PrismaClient, Prisma } from "@prisma/client";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { db } from "../src/lib/db";
import { storeDocument } from "../src/lib/documents";
import { audit } from "../src/lib/audit";
import { cents } from "../src/lib/money";
import { supportsPasswordHash } from "../src/lib/password";
const legacy = new PrismaClient({
  datasourceUrl: process.env.LEGACY_DATABASE_URL ?? process.env.DATABASE_URL,
});
type Item = {
  category: string;
  invoice_id: bigint | null;
  document_id: bigint | null;
  due_number: number | null;
  due_date: Date | null;
  summary_month: Date;
  expected_amount: Prisma.Decimal;
  paid_amount: Prisma.Decimal | null;
  payment_date: Date | null;
  issuer: string;
  payment_status: string;
  extraordinary: Prisma.Decimal | null;
  source_reference: string | null;
  manual_id: bigint | null;
};
async function table(name: string) {
  const [row] = await legacy.$queryRaw<
    { exists: boolean }[]
  >`SELECT to_regclass(${name}) IS NOT NULL AS exists`;
  return row.exists;
}
async function main() {
  const hasLegacy = await table("public.auth_user");
  const hasItems = await table("gold.shared_expense_items");
  if (!hasLegacy && !hasItems) {
    console.log("No legacy household tables found; nothing to import.");
    return;
  }
  // Frozen reporting snapshot is read only. No transform, sync, or external calls.
  let userCount = 0,
    documentCount = 0,
    expenseCount = 0,
    rentCount = 0;
  if (hasLegacy) {
    const users = await legacy.$queryRaw<
      { username: string; password: string; is_active: boolean }[]
    >`SELECT username,password,is_active FROM public.auth_user WHERE username IN ('emiliano','vitoria')`;
    for (const user of users) {
      if (!supportsPasswordHash(user.password))
        throw new Error(
          "Unsupported legacy password format; stop before cutover and arrange a password migration.",
        );
      await db.user.upsert({
        where: { username: user.username },
        create: {
          username: user.username,
          name: user.username === "emiliano" ? "Emiliano" : "Vitoria",
          passwordHash: user.password,
          active: user.is_active,
        },
        update: {},
      });
      userCount++;
    }
  }
  if (!hasItems)
    throw new Error(
      "Legacy household tables exist but the shared-expenses snapshot is missing. Do not cut over to an empty app.",
    );
  const items = await legacy.$queryRaw<Item[]>`SELECT i.*,
    CASE WHEN i.category='Expensas' THEN (SELECT sum(l.amount) FROM silver.invoice_line_items l WHERE l.invoice_id=i.invoice_id AND l.concept_code='extraordinary_expenses') ELSE 0 END AS extraordinary,
    m.source_reference, m.id AS manual_id
    FROM gold.shared_expense_items i
    LEFT JOIN bronze.manual_shared_expenses m ON i.invoice_id IS NULL AND i.summary_month=m.summary_month AND i.category=m.category AND i.issuer=m.issuer
    ORDER BY i.summary_month, i.category, i.invoice_id, i.due_number`;
  const documents = new Map<string, string>();
  const ids = [
    ...new Set(
      items.flatMap((i) =>
        i.document_id === null ? [] : [i.document_id.toString()],
      ),
    ),
  ];
  for (const id of ids) {
    const [old] = await legacy.$queryRaw<
      {
        document_id: bigint;
        original_filename: string;
        sha256: string;
        storage_path: string;
      }[]
    >`SELECT document_id,original_filename,sha256,storage_path FROM gold.documents WHERE document_id=${BigInt(id)}`;
    if (!old)
      throw new Error(
        "A legacy invoice references a missing document. Original tables remain untouched.",
      );
    const root = await realpath(
      resolve(process.env.LEGACY_DOCUMENT_ROOT ?? "data"),
    );
    let relative = old.storage_path.replace(/\\/g, "/");
    if (relative.startsWith("/data/")) relative = relative.slice(6);
    else if (relative.startsWith("data/")) relative = relative.slice(5);
    const path = await realpath(resolve(root, relative));
    if (!path.startsWith(root + sep))
      throw new Error("Legacy document outside the trusted data directory.");
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== old.sha256)
      throw new Error("Legacy document integrity check failed.");
    const doc = await storeDocument(
      bytes,
      old.original_filename,
      "migration",
      "legacy",
    );
    documents.set(id, doc.id);
    documentCount++;
  }
  // Each row commits together with its audit and payment. Re-runs only insert missing rows.
  for (const item of items) {
    const sourceKey =
      item.invoice_id !== null
        ? `legacy:invoice:${item.invoice_id}:${item.due_number}`
        : `legacy:manual:${item.manual_id}`;
    if (item.invoice_id === null && item.manual_id === null)
      throw new Error(
        "Manual source lineage missing; refusing an ambiguous import.",
      );
    await db.$transaction(async (tx) => {
      if (await tx.expense.findUnique({ where: { sourceKey } })) return;
      const documentId =
        item.document_id !== null
          ? documents.get(item.document_id.toString())
          : undefined;
      const dueDate = item.due_date ?? item.summary_month;
      const amountCents = cents(item.expected_amount.toFixed(2));
      const extraordinaryCents = cents(item.extraordinary?.toFixed(2) ?? "0");
      if (amountCents === 0n) return;
      // A manually uploaded original must not become a second obligation after cutover.
      if (documentId) {
        const existing = await tx.expense.findFirst({
          where: { documentId, dueDate, archived: false },
        });
        if (existing) {
          await audit(
            tx,
            "migration",
            "legacy.import",
            "expense",
            existing.id,
            null,
            { sourceKey, matchedExisting: true, legacy: item },
          );
          return;
        }
      }
      const expense = await tx.expense.create({
        data: {
          title: `${item.category} · ${item.issuer}`,
          category: item.category,
          // Internet is personal; retain its source without adding it to the split.
          archived: item.category === "Internet",
          dueDate,
          amountCents,
          extraordinaryCents,
          documentId,
          sourceKey,
          notes:
            "Importado del historial anterior. Si hay un pago sin responsable, anulalo y registralo de nuevo con quien pagó.",
        },
      });
      if (
        item.payment_date &&
        item.paid_amount &&
        item.paid_amount.greaterThan(0)
      )
        await tx.payment.create({
          data: {
            expenseId: expense.id,
            payer: "unassigned",
            amountCents: cents(item.paid_amount.toFixed(2)),
            paidAt: item.payment_date,
            sourceKey: `${sourceKey}:payment`,
            notes:
              "Pago del sistema anterior. Confirmar quién pagó antes de repartir adelantos.",
          },
        });
      await audit(
        tx,
        "migration",
        "legacy.import",
        "expense",
        expense.id,
        null,
        { ...expense, legacy: item },
      );
      expenseCount++;
    });
  }
  if (await table("bronze.manual_monthly_rents")) {
    const rents = await legacy.$queryRaw<
      { summary_month: Date; gross_amount: Prisma.Decimal }[]
    >`SELECT summary_month,gross_amount FROM bronze.manual_monthly_rents ORDER BY summary_month`;
    for (const r of rents) {
      const month = r.summary_month.toISOString().slice(0, 7);
      await db.$transaction(async (tx) => {
        if (await tx.rent.findUnique({ where: { month } })) return;
        const rent = await tx.rent.create({
          data: { month, grossCents: cents(r.gross_amount.toFixed(2)) },
        });
        await audit(
          tx,
          "migration",
          "legacy.import",
          "rent",
          month,
          null,
          rent,
        );
        rentCount++;
      });
    }
  }
  if (await table("gold.movements")) {
    const payments = await legacy.$queryRaw<
      {
        source_movement_id: string;
        release_date: Date;
        amount: Prisma.Decimal;
      }[]
    >`SELECT source_movement_id,release_date,abs(amount) AS amount FROM gold.movements WHERE category='Alquiler' AND amount<>0 ORDER BY release_date`;
    for (const p of payments) {
      const month = p.release_date.toISOString().slice(0, 7);
      const sourceKey = `legacy:rent-payment:${p.source_movement_id}`;
      if (!(await db.rent.findUnique({ where: { month } }))) {
        // Payment history is preserved in audit rather than inventing an agreed gross rent.
        if (
          !(await db.auditEvent.findFirst({
            where: { action: "legacy.import", entityId: sourceKey },
          }))
        )
          await db.$transaction((tx) =>
            audit(
              tx,
              "migration",
              "legacy.import",
              "legacy-rent-payment",
              sourceKey,
              null,
              { ...p, needsRentConfirmation: true },
            ),
          );
        continue;
      }
      await db.$transaction(async (tx) => {
        if (await tx.payment.findUnique({ where: { sourceKey } })) return;
        const row = await tx.payment.create({
          data: {
            rentMonth: month,
            payer: "unassigned",
            amountCents: cents(p.amount.toFixed(2)),
            paidAt: p.release_date,
            sourceKey,
            notes: "Pago del sistema anterior: confirmar responsable.",
          },
        });
        await audit(
          tx,
          "migration",
          "legacy.import",
          "payment",
          row.id,
          null,
          row,
        );
      });
    }
  }
  console.log(
    `Legacy import complete: ${userCount} users, ${documentCount} documents checked, ${expenseCount} new expenses, ${rentCount} new rents. Original schemas unchanged.`,
  );
}
main()
  .catch(() => {
    console.error(
      "Legacy import stopped. Original tables and documents are unchanged. Review missing source records, document paths, hashes or password format before retrying. Do not cut over.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    await legacy.$disconnect();
  });
