import { config } from "dotenv";
config({
  path: ".env.local",
  quiet: true,
  override: !process.env.HOUSE_OPS_DATABASE_OVERRIDE,
});
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
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
const record = z
  .object({
    title: z.string().min(1).max(100),
    category: z.enum(categories),
    dueDate: dateSchema,
    amount: amountSchema.refine((v) => v > 0n),
    extraordinary: amountSchema.prefault("0"),
    notes: z.string().max(2000).default(""),
    pdf: z.string().optional(),
    sourceKey: z.string().min(1).max(200),
  })
  .refine(
    (v) =>
      v.extraordinary <= v.amount &&
      (v.category === "Expensas" || v.extraordinary === 0n),
  );
const manifest = z.object({
  expenses: z.array(record).default([]),
  rents: z
    .array(
      z.object({
        month: monthSchema,
        gross: amountSchema.refine((v) => v > 0n),
      }),
    )
    .default([]),
});
async function main() {
  const path = process.argv[2];
  if (!path)
    throw new Error(
      "Provide a private JSON manifest. Never commit household imports.",
    );
  const data = manifest.parse(JSON.parse(await readFile(path, "utf8")));
  for (const r of data.expenses) {
    if (await db.expense.findUnique({ where: { sourceKey: r.sourceKey } }))
      continue;
    let documentId: string | undefined;
    if (r.pdf) {
      const bytes = await readFile(resolve(dirname(path), r.pdf));
      documentId = (
        await storeDocument(bytes, basename(r.pdf), "emiliano", "assistant")
      ).id;
    }
    await db.$transaction(async (tx) => {
      if (
        documentId &&
        (await tx.expense.findFirst({
          where: { documentId, dueDate: utcDate(r.dueDate), archived: false },
        }))
      )
        return;
      const row = await tx.expense.create({
        data: {
          title: r.title,
          category: r.category,
          dueDate: utcDate(r.dueDate),
          amountCents: r.amount,
          extraordinaryCents: r.extraordinary,
          notes: r.notes,
          documentId,
          sourceKey: r.sourceKey,
        },
      });
      await audit(tx, "emiliano", "expense.create", "expense", row.id, null, {
        ...row,
        assistedBy: "Codex",
        confirmedFromSource: true,
      });
    });
  }
  for (const r of data.rents) {
    await db.$transaction(async (tx) => {
      if (await tx.rent.findUnique({ where: { month: r.month } })) return;
      const row = await tx.rent.create({
        data: { month: r.month, grossCents: r.gross },
      });
      await audit(tx, "emiliano", "rent.save", "rent", r.month, null, {
        ...row,
        assistedBy: "Codex",
      });
    });
  }
  console.log(
    "Private records imported. Existing records and payments were preserved.",
  );
}
main()
  .catch(() => {
    console.error(
      "Import stopped. Check the private manifest and readable PDFs; original records were preserved.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
