import { config } from "dotenv";
config({
  path: ".env.local",
  quiet: true,
  override: !process.env.HOUSE_OPS_DATABASE_OVERRIDE,
});
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve, dirname, basename, sep } from "node:path";
import { createHash } from "node:crypto";
import { db } from "../src/lib/db";
import { storeDocument } from "../src/lib/documents";
import { audit } from "../src/lib/audit";
import {
  amountSchema,
  categories,
  dateSchema,
  monthSchema,
  utcDate,
} from "../src/lib/money";
const positive = amountSchema.refine((v) => v > 0n);
const key = z.string().min(1).max(200);
const manifest = z.object({
  expenses: z
    .array(
      z
        .object({
          title: z.string().min(1).max(100),
          category: z.enum(categories),
          dueDate: dateSchema,
          amount: positive,
          extraordinary: amountSchema.prefault("0"),
          notes: z.string().max(2000).default(""),
          sourceKey: key,
          pdf: z.string().optional(),
          sha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .refine(
          (r) =>
            r.extraordinary <= r.amount &&
            (r.category === "Expensas" || r.extraordinary === 0n),
        ),
    )
    .max(1000),
  rents: z
    .array(
      z.object({
        month: monthSchema,
        gross: positive,
        creditOverride: amountSchema.nullable().default(null),
        creditReason: z.string().max(1000).default(""),
      }),
    )
    .default([]),
  payments: z
    .array(
      z
        .object({
          expenseSourceKey: key.optional(),
          rentMonth: monthSchema.optional(),
          payer: z.enum(["emiliano", "vitoria", "unassigned"]),
          amount: positive,
          paidAt: dateSchema,
          notes: z.string().max(1000).default(""),
          sourceKey: key,
        })
        .refine((p) => Boolean(p.expenseSourceKey) !== Boolean(p.rentMonth)),
    )
    .default([]),
  settlements: z
    .array(
      z.object({
        month: monthSchema,
        from: z.enum(["emiliano", "vitoria"]),
        amount: positive,
        paidAt: dateSchema,
        notes: z.string().max(1000).default(""),
        sourceKey: key,
      }),
    )
    .default([]),
});
async function main() {
  const file = resolve(process.argv[2] ?? "");
  if (!process.argv[2]) throw Error("Private manifest required");
  const data = manifest.parse(JSON.parse(await readFile(file, "utf8")));
  if (
    new Set(data.expenses.map((r) => r.sourceKey)).size !== data.expenses.length
  )
    throw Error("Repeated source keys");
  const documents = new Map<string, string>();
  for (const r of data.expenses) {
    if (!r.pdf) {
      if (r.sha256) {
        const doc = await db.document.findUniqueOrThrow({
          where: { sha256: r.sha256 },
        });
        documents.set(r.sourceKey, doc.id);
      }
      continue;
    }
    const path = resolve(dirname(file), r.pdf);
    if (!path.startsWith(dirname(file) + sep) || !r.sha256)
      throw Error("Document path or hash missing");
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== r.sha256)
      throw Error("Document integrity mismatch");
    documents.set(
      r.sourceKey,
      (await storeDocument(bytes, basename(path), "emiliano", "handoff")).id,
    );
  }
  await db.$transaction(
    async (tx) => {
      const ids = new Map<string, string>();
      for (const r of data.expenses) {
        const documentId = documents.get(r.sourceKey);
        let row = await tx.expense.findUnique({
          where: { sourceKey: r.sourceKey },
        });
        if (!row && documentId)
          row = await tx.expense.findFirst({
            where: { documentId, dueDate: utcDate(r.dueDate) },
          });
        // Older imports with no PDF can still represent the same supplier obligation.
        if (!row)
          row = await tx.expense.findFirst({
            where: {
              category: r.category,
              dueDate: utcDate(r.dueDate),
              title: r.title,
              archived: false,
            },
          });
        if (row) {
          if (
            row.archived ||
            row.amountCents !== r.amount ||
            row.extraordinaryCents !== r.extraordinary ||
            row.category !== r.category ||
            row.dueDate.toISOString().slice(0, 10) !== r.dueDate ||
            (row.documentId && documentId && row.documentId !== documentId)
          )
            throw Error(`Expense conflict: ${r.category} ${r.dueDate}`);
          if (!row.documentId && documentId) {
            const before = row;
            row = await tx.expense.update({
              where: { id: row.id },
              data: { documentId, version: { increment: 1 } },
            });
            await audit(
              tx,
              "emiliano",
              "expense.update",
              "expense",
              row.id,
              before,
              { ...row, assistedBy: "Codex", handoffSourceKey: r.sourceKey },
            );
          }
        } else {
          row = await tx.expense.create({
            data: {
              title: r.title,
              category: r.category,
              dueDate: utcDate(r.dueDate),
              amountCents: r.amount,
              extraordinaryCents: r.extraordinary,
              notes: r.notes,
              sourceKey: r.sourceKey,
              documentId,
            },
          });
          await audit(
            tx,
            "emiliano",
            "expense.create",
            "expense",
            row.id,
            null,
            { ...row, assistedBy: "Codex", confirmedFromSource: true },
          );
        }
        ids.set(r.sourceKey, row.id);
      }
      for (const r of data.rents) {
        const existing = await tx.rent.findUnique({
          where: { month: r.month },
        });
        if (existing) {
          if (
            existing.grossCents !== r.gross ||
            existing.creditOverrideCents !== r.creditOverride
          )
            throw Error(`Rent conflict: ${r.month}`);
          continue;
        }
        const row = await tx.rent.create({
          data: {
            month: r.month,
            grossCents: r.gross,
            creditOverrideCents: r.creditOverride,
            creditReason: r.creditReason,
          },
        });
        await audit(tx, "emiliano", "rent.save", "rent", r.month, null, {
          ...row,
          assistedBy: "Codex",
        });
      }
      for (const p of data.payments) {
        const expenseId = p.expenseSourceKey
          ? ids.get(p.expenseSourceKey)
          : undefined;
        if (p.expenseSourceKey && !expenseId)
          throw Error("Payment obligation missing");
        const existing = await tx.payment.findUnique({
          where: { sourceKey: p.sourceKey },
        });
        if (existing) {
          if (
            existing.voided ||
            existing.amountCents !== p.amount ||
            existing.payer !== p.payer ||
            existing.expenseId !== (expenseId ?? null) ||
            existing.rentMonth !== (p.rentMonth ?? null) ||
            existing.paidAt.toISOString().slice(0, 10) !== p.paidAt
          )
            throw Error("Payment source conflict");
          continue;
        }
        const target = expenseId ? { expenseId } : { rentMonth: p.rentMonth! };
        const same = await tx.payment.findFirst({
          where: {
            ...target,
            voided: false,
            amountCents: p.amount,
            paidAt: utcDate(p.paidAt),
          },
        });
        if (same) {
          if (same.payer !== p.payer && p.payer !== "unassigned")
            throw Error("Payment payer conflict");
          continue;
        }
        let total: bigint;
        if (expenseId)
          total = (
            await tx.expense.findUniqueOrThrow({ where: { id: expenseId } })
          ).amountCents;
        else {
          const rent = await tx.rent.findUniqueOrThrow({
            where: { month: p.rentMonth },
          });
          const [year, month] = p.rentMonth!.split("-").map(Number);
          const previous = new Date(Date.UTC(year, month - 2, 1));
          const current = new Date(Date.UTC(year, month - 1, 1));
          const extras = await tx.expense.aggregate({
            where: {
              archived: false,
              category: "Expensas",
              dueDate: { gte: previous, lt: current },
            },
            _sum: { extraordinaryCents: true },
          });
          const credit =
            rent.creditOverrideCents ?? extras._sum.extraordinaryCents ?? 0n;
          total = rent.grossCents > credit ? rent.grossCents - credit : 0n;
        }
        const paid = await tx.payment.aggregate({
          where: { ...target, voided: false },
          _sum: { amountCents: true },
        });
        if ((paid._sum.amountCents ?? 0n) + p.amount > total)
          throw Error("Payment exceeds obligation");
        const row = await tx.payment.create({
          data: {
            ...target,
            payer: p.payer,
            amountCents: p.amount,
            paidAt: utcDate(p.paidAt),
            notes: p.notes,
            sourceKey: p.sourceKey,
          },
        });
        await audit(tx, "emiliano", "payment.create", "payment", row.id, null, {
          ...row,
          assistedBy: "Codex",
          confirmedFromSource: true,
        });
      }
      for (const s of data.settlements) {
        if (
          await tx.auditEvent.findFirst({
            where: {
              action: "settlement.create",
              after: { path: ["handoffSourceKey"], equals: s.sourceKey },
            },
          })
        )
          continue;
        const row = await tx.settlement.create({
          data: {
            month: s.month,
            from: s.from,
            amountCents: s.amount,
            paidAt: utcDate(s.paidAt),
            notes: s.notes,
          },
        });
        await audit(
          tx,
          "emiliano",
          "settlement.create",
          "settlement",
          row.id,
          null,
          { ...row, assistedBy: "Codex", handoffSourceKey: s.sourceKey },
        );
      }
    },
    { isolationLevel: "Serializable", timeout: 60000 },
  );
  console.log(
    `Verified handoff: ${data.expenses.length} obligations, ${data.rents.length} rents, ${data.payments.length} payments, ${data.settlements.length} transfers. Existing history preserved; repeated loads are idempotent.`,
  );
}
main()
  .catch((e) => {
    const message =
      e instanceof Error &&
      /^(Expense conflict:|Rent conflict:|Payment source conflict|Payment payer conflict|Payment exceeds obligation)/.test(
        e.message,
      )
        ? e.message
        : "Private handoff failed validation; no financial transaction committed.";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
