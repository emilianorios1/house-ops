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
      ],
    },
    include: { document: true },
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
    });
  }
  const rents = await db.rent.findMany({
    where: { month: { lt: "2090-01" } },
    orderBy: { month: "asc" },
  });
  await writeFile(
    resolve(root, "records.json"),
    JSON.stringify(
      {
        expenses: records,
        rents: rents.map((r) => ({
          month: r.month,
          gross: decimal(r.grossCents),
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    `Private handoff ready: ${records.length} obligations and ${rents.length} agreed rents. No credentials or inferred payments included; never commit this directory.`,
  );
}
main().finally(() => db.$disconnect());
