import { config } from "dotenv";
config({
  path: ".env.local",
  quiet: true,
  override: !process.env.HOUSE_OPS_DATABASE_OVERRIDE,
});
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { syntheticPdf } from "../tests-next/helpers";
import { calculateMonth } from "../src/lib/calculation";
const rootUrl = new URL(process.env.DATABASE_URL!);
assert.ok(["localhost", "127.0.0.1"].includes(rootUrl.hostname));
const root = new PrismaClient();
const name = `house_ops_handoff_test_${Date.now()}`;
const url = new URL(rootUrl);
url.pathname = `/${name}`;
const db = new PrismaClient({ datasourceUrl: url.href });
const folder = resolve(".private/handoff-fixtures");
mkdirSync(folder, { recursive: true });
const bytes = syntheticPdf(["Synthetic portable invoice"]);
const sha = createHash("sha256").update(bytes).digest("hex");
writeFileSync(resolve(folder, "original.pdf"), bytes);
const key = `${sha.slice(0, 2)}/${sha}.pdf`;
mkdirSync(resolve(folder, sha.slice(0, 2)), { recursive: true });
writeFileSync(resolve(folder, key), bytes);
const file = resolve(folder, "records.json");
const data = {
  expenses: [
    {
      title: "Expensas · Synthetic",
      category: "Expensas",
      dueDate: "2026-09-14",
      amount: "150.00",
      extraordinary: "50.00",
      pdf: "original.pdf",
      sha256: sha,
      sourceKey: "pdf:synthetic:2026-09-14",
    },
    {
      title: "TGI · Synthetic",
      category: "TGI",
      dueDate: "2026-09-10",
      amount: "80.00",
      extraordinary: "0",
      sourceKey: "household:tgi:2026-09",
    },
  ],
  rents: [{ month: "2026-10", gross: "1000.00" }],
  payments: [
    {
      expenseSourceKey: "household:tgi:2026-09",
      payer: "unassigned",
      amount: "80.00",
      paidAt: "2026-08-08",
      sourceKey: "evidence:synthetic:tgi:2026-09",
    },
  ],
};
writeFileSync(file, JSON.stringify(data));
const env = {
  ...process.env,
  HOUSE_OPS_DATABASE_OVERRIDE: "1",
  DATABASE_URL: url.href,
  DOCUMENT_STORE_PATH: folder,
};
function run(script: string, args: string[] = [], expected = 0) {
  const r = spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    env,
    stdio: "inherit",
  });
  assert.equal(r.status, expected);
}
async function main() {
  await root.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  try {
    run("scripts/migrate.ts");
    const doc = await db.document.create({
      data: {
        sha256: sha,
        filename: "legacy.pdf",
        storageKey: key,
        byteSize: bytes.length,
        source: "legacy",
      },
    });
    await db.expense.create({
      data: {
        title: "Expensas · Synthetic",
        category: "Expensas",
        dueDate: new Date("2026-09-14"),
        amountCents: 15000n,
        extraordinaryCents: 5000n,
        documentId: doc.id,
        sourceKey: "legacy:invoice:1:1",
      },
    });
    run("scripts/import-handoff.ts", [file]);
    run("scripts/import-handoff.ts", [file]);
    assert.equal(await db.expense.count(), 2);
    assert.equal(await db.payment.count(), 1);
    assert.equal(await db.document.count(), 1);
    assert.equal(await db.rent.count(), 1);
    const bills = await db.expense.findMany({ include: { payments: true } });
    const result = calculateMonth(bills, [], null, []);
    assert.equal(result.total, 23000n);
    assert.equal(result.unassignedPaid, 8000n);
    assert.equal(result.reimbursement, 0n);
    const before = await db.auditEvent.count();
    data.expenses[0].amount = "151.00";
    writeFileSync(file, JSON.stringify(data));
    run("scripts/import-handoff.ts", [file], 1);
    assert.equal(await db.expense.count(), 2);
    assert.equal(await db.auditEvent.count(), before);
    assert.equal(
      (await db.expense.findFirstOrThrow({ where: { category: "Expensas" } }))
        .amountCents,
      15000n,
    );
    console.log(
      "PASS: portable PDF hashes, legacy deduplication, TGI without PDF, recorded unassigned payment, rent preservation, idempotence and atomic conflict rejection.",
    );
  } finally {
    await db.$disconnect();
    await root.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await root.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Private handoff fixtures failed; household and production data were not used.",
  );
  process.exitCode = 1;
});
