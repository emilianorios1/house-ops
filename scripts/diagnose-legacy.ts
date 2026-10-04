import { PrismaClient } from "@prisma/client";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { pdfText } from "../src/lib/documents";
const db = new PrismaClient();
let phase = "source-query";
try {
  const items = await db.$queryRaw<
    { document_id: bigint | null }[]
  >`SELECT i.*, CASE WHEN i.category='Expensas' THEN (SELECT sum(l.amount) FROM silver.invoice_line_items l WHERE l.invoice_id=i.invoice_id AND l.concept_code='extraordinary_expenses') ELSE 0 END AS extraordinary,m.source_reference,m.id AS manual_id FROM gold.shared_expense_items i LEFT JOIN bronze.manual_shared_expenses m ON i.invoice_id IS NULL AND i.summary_month=m.summary_month AND i.category=m.category AND i.issuer=m.issuer ORDER BY i.summary_month,i.category,i.invoice_id,i.due_number`;
  console.log(`Source query valid: ${items.length} obligations.`);
  const ids = [
    ...new Set(
      items.flatMap((r) =>
        r.document_id === null ? [] : [r.document_id.toString()],
      ),
    ),
  ];
  for (const id of ids) {
    phase = "document-metadata";
    const [doc] = await db.$queryRaw<
      { storage_path: string; sha256: string }[]
    >`SELECT storage_path,sha256 FROM gold.documents WHERE document_id=${BigInt(id)}`;
    if (!doc) throw Error("MissingDocument");
    let relative = doc.storage_path.replace(/\\/g, "/");
    const style = relative.startsWith("/data/")
      ? "data-absolute"
      : relative.startsWith("data/")
        ? "data-relative"
        : relative.startsWith("/")
          ? "other-absolute"
          : "relative";
    if (relative.startsWith("/data/")) relative = relative.slice(6);
    else if (relative.startsWith("data/")) relative = relative.slice(5);
    phase = "document-path-" + style;
    const root = await realpath("/data");
    const path = await realpath(resolve(root, relative));
    if (!path.startsWith(root + sep)) throw Error("OutsideRoot");
    phase = "document-hash";
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== doc.sha256)
      throw Error("HashMismatch");
    phase = "document-parse";
    await pdfText(bytes);
    console.log("Referenced document path, hash and PDF parsing valid.");
  }
  console.log("Read-only legacy diagnostics passed.");
} catch (error) {
  const e = error as { name?: string; code?: string; meta?: { code?: string } };
  console.error(
    JSON.stringify({
      phase,
      errorType: e.name,
      code: e.code,
      sqlCode: e.meta?.code,
      databaseWrites: 0,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
