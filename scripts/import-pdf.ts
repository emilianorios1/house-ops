import { config } from "dotenv";
config({
  path: ".env.local",
  quiet: true,
  override: !process.env.HOUSE_OPS_DATABASE_OVERRIDE,
});
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { db } from "../src/lib/db";
import { storeDocument, pdfText, parseExpensas } from "../src/lib/documents";
import { audit } from "../src/lib/audit";
import { utcDate } from "../src/lib/money";
async function main() {
  const files = process.argv.slice(2);
  if (!files.length)
    throw new Error(
      "Usage: npm run import:pdf -- /absolute/path/statement.pdf",
    );
  for (const file of files) {
    const bytes = await readFile(file);
    const parsed = parseExpensas(await pdfText(bytes));
    if (!parsed)
      throw new Error(
        "Unsupported statement. Upload it in the app and enter the fields manually.",
      );
    const doc = await storeDocument(
      bytes,
      basename(file),
      "emiliano",
      "assistant",
    );
    const key = `pdf:${doc.sha256}:${parsed.dueDate}`;
    await db.$transaction(async (tx) => {
      const existing = await tx.expense.findFirst({
        where: {
          OR: [
            { sourceKey: key },
            { documentId: doc.id, dueDate: utcDate(parsed.dueDate) },
          ],
        },
      });
      if (existing) return;
      const expense = await tx.expense.create({
        data: {
          ...parsed,
          dueDate: utcDate(parsed.dueDate),
          documentId: doc.id,
          sourceKey: key,
        },
      });
      await audit(
        tx,
        "emiliano",
        "expense.create",
        "expense",
        expense.id,
        null,
        { ...expense, assistedBy: "Codex", parser: "concorde-v1" },
      );
    });
    console.log(
      "Statement stored; duplicate imports are skipped. No payments inferred.",
    );
  }
}
main()
  .catch(() => {
    console.error(
      "PDF import failed; source files unchanged. Check that each file is a supported, readable PDF.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
