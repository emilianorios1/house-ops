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
import { createHash, pbkdf2Sync } from "node:crypto";
import assert from "node:assert/strict";
import { syntheticPdf } from "../tests-next/helpers";
import { verifyPassword } from "../src/lib/password";
const rootUrl = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(rootUrl.hostname))
  throw new Error("Migration tests only support local PostgreSQL.");
const rootDb = new PrismaClient();
const name = `house_ops_migration_test_${Date.now()}`;
const url = new URL(rootUrl);
url.pathname = `/${name}`;
const db = new PrismaClient({ datasourceUrl: url.href });
const documentRoot = resolve(".private/migration-fixtures");
mkdirSync(documentRoot, { recursive: true });
const bytes = syntheticPdf(["Synthetic household fixture"]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
writeFileSync(resolve(documentRoot, "fixture.pdf"), bytes);
const env = {
  ...process.env,
  HOUSE_OPS_DATABASE_OVERRIDE: "1",
  DATABASE_URL: url.href,
  LEGACY_DOCUMENT_ROOT: documentRoot,
};
function run(script: string) {
  const r = spawnSync(process.execPath, ["--import", "tsx", script], {
    env,
    stdio: "inherit",
  });
  assert.equal(r.status, 0, `${script} failed`);
}
async function main() {
  await rootDb.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  try {
    await db.$executeRawUnsafe(
      "CREATE TABLE auth_user (username text,password text,is_active boolean)",
    );
    const hash = `pbkdf2_sha256$1000$synthetic-salt$${pbkdf2Sync("synthetic-password", "synthetic-salt", 1000, 32, "sha256").toString("base64")}`;
    await db.$executeRaw`INSERT INTO auth_user VALUES ('emiliano',${hash},true)`;
    for (const schema of ["gold", "silver", "bronze"])
      await db.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
    await db.$executeRawUnsafe(
      "CREATE TABLE gold.documents (document_id bigint,original_filename text,sha256 text,storage_path text)",
    );
    await db.$executeRaw`INSERT INTO gold.documents VALUES (1,'fixture.pdf',${sha256},'fixture.pdf')`;
    await db.$executeRawUnsafe(
      "CREATE TABLE silver.invoice_line_items (invoice_id bigint,concept_code text,amount numeric)",
    );
    await db.$executeRawUnsafe(
      "INSERT INTO silver.invoice_line_items VALUES (1,'extraordinary_expenses',50)",
    );
    await db.$executeRawUnsafe(
      "CREATE TABLE bronze.manual_shared_expenses (id bigint, summary_month date, category text, issuer text, source_reference text)",
    );
    await db.$executeRawUnsafe(
      "CREATE TABLE gold.shared_expense_items (category text,invoice_id bigint,document_id bigint,due_number integer,due_date date,summary_month date,expected_amount numeric,paid_amount numeric,payment_date date,issuer text,payment_status text)",
    );
    await db.$executeRawUnsafe(
      "INSERT INTO gold.shared_expense_items VALUES ('Expensas',1,1,1,'2026-09-14','2026-09-01',150,150,'2026-09-13','Synthetic','paid')",
    );
    await db.$executeRawUnsafe(
      "INSERT INTO gold.shared_expense_items VALUES ('Internet',2,NULL,1,'2026-09-16','2026-09-01',80,0,NULL,'Synthetic','unpaid')",
    );
    await db.$executeRawUnsafe(
      "CREATE TABLE bronze.manual_monthly_rents (summary_month date,gross_amount numeric)",
    );
    await db.$executeRawUnsafe(
      "INSERT INTO bronze.manual_monthly_rents VALUES ('2026-10-01',1000)",
    );
    await db.$executeRawUnsafe(
      "CREATE TABLE gold.movements (source_movement_id text,release_date date,amount numeric,category text)",
    );
    await db.$executeRawUnsafe(
      "INSERT INTO gold.movements VALUES ('synthetic-rent','2026-10-01',-950,'Alquiler')",
    );
    run("scripts/migrate.ts");
    run("scripts/import-legacy.ts");
    run("scripts/import-legacy.ts");
    assert.equal(await db.expense.count(), 2);
    assert.equal(await db.expense.count({ where: { archived: false } }), 1);
    const internet = await db.expense.findFirstOrThrow({
      where: { category: "Internet" },
    });
    assert.equal(internet.archived, true);
    assert.equal(internet.amountCents, 8000n);
    assert.equal(await db.document.count(), 1);
    assert.equal(await db.payment.count(), 2);
    assert.equal(await db.rent.count(), 1);
    const user = await db.user.findUniqueOrThrow({
      where: { username: "emiliano" },
    });
    assert(verifyPassword("synthetic-password", user.passwordHash));
    const expense = await db.expense.findFirstOrThrow({
      where: { category: "Expensas" },
    });
    assert.equal(expense.extraordinaryCents, 5000n);
    assert.equal(expense.amountCents, 15000n);
    assert(
      (await db.payment.findMany()).every((p) => p.payer === "unassigned"),
    );
    const [{ count }] = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM gold.shared_expense_items`;
    assert.equal(count, 2n);
    const event = await db.auditEvent.findFirstOrThrow();
    await assert.rejects(() =>
      db.auditEvent.update({
        where: { id: event.id },
        data: { actor: "tampered" },
      }),
    );
    await assert.rejects(() =>
      db.expense.create({
        data: {
          title: "Invalid",
          category: "Luz",
          dueDate: new Date("2026-10-01"),
          amountCents: 100n,
          extraordinaryCents: 1n,
        },
      }),
    );
    console.log(
      "PASS: existing database baseline, legacy import, original tables, credentials, PDF hash, idempotence, unassigned payments, money constraints, immutable audit.",
    );
  } finally {
    await db.$disconnect();
    await rootDb.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await rootDb.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Migration fixture validation failed. No household or production data was used.",
  );
  process.exitCode = 1;
});
