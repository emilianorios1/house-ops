import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { changePassword } from "./change-password";
import { provisionAuthUsers } from "../src/lib/auth-provision";
import { hashPassword, verifyPassword } from "../src/lib/password";

export async function verifyPasswordReset(
  db: PrismaClient,
  env: NodeJS.ProcessEnv,
) {
  const oldPassword = "synthetic-old-password";
  const newPassword = "synthetic-new-password-ñ";
  const passwordHash = hashPassword(oldPassword);
  const vitoria = await db.user.update({
    where: { username: "vitoria" },
    data: {
      active: true,
      passwordHash,
    },
  });
  await provisionAuthUsers(db);
  await db.authAccount.update({
    where: {
      providerId_accountId: {
        providerId: "credential",
        accountId: vitoria.id,
      },
    },
    data: { password: passwordHash },
  });
  const other = await db.user.findUniqueOrThrow({
    where: { username: "emiliano" },
  });
  await db.authSession.createMany({
    data: [vitoria.id, other.id].map((userId) => ({
      id: `password-fixture-${userId}`,
      token: `password-fixture-${userId}`,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })),
  });
  await db.loginAttempt.createMany({
    data: ["vitoria", "emiliano"].map((username) => ({ username, count: 16 })),
  });
  const snapshot = async () =>
    JSON.stringify({
      users: await db.user.findMany({ orderBy: { id: "asc" } }),
      accounts: await db.authAccount.findMany({ orderBy: { id: "asc" } }),
      sessions: await db.authSession.findMany({ orderBy: { id: "asc" } }),
      attempts: await db.loginAttempt.findMany({
        orderBy: { username: "asc" },
      }),
      events: await db.auditEvent.findMany({ orderBy: { id: "asc" } }),
    });
  const before = await snapshot();
  await assert.rejects(() => changePassword(db, "missing", newPassword));
  await assert.rejects(() => changePassword(db, "vitoria", "short"));
  await db.user.update({ where: { id: vitoria.id }, data: { active: false } });
  await assert.rejects(() => changePassword(db, "vitoria", newPassword));
  await db.user.update({ where: { id: vitoria.id }, data: { active: true } });
  await db.authUser.update({
    where: { id: vitoria.id },
    data: { email: "inconsistent@casa.invalid" },
  });
  await assert.rejects(() => changePassword(db, "vitoria", newPassword));
  await db.authUser.update({
    where: { id: vitoria.id },
    data: { email: "vitoria@casa.invalid" },
  });
  assert.equal(await snapshot(), before);

  // A real database failure after the password updates must roll everything back.
  await db.$executeRawUnsafe(
    `CREATE FUNCTION reject_password_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'password.reset' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER reject_password_audit BEFORE INSERT ON shared_audit_events FOR EACH ROW EXECUTE FUNCTION reject_password_audit()`,
  );
  await assert.rejects(() => changePassword(db, "vitoria", newPassword));
  assert.equal(await snapshot(), before);
  await db.$executeRawUnsafe(
    `DROP TRIGGER reject_password_audit ON shared_audit_events`,
  );
  await db.$executeRawUnsafe(`DROP FUNCTION reject_password_audit()`);

  // Exercise the same source-through-eval and stdin transport as the VPS wrapper.
  const source =
    readFileSync(resolve("scripts/change-password.ts"), "utf8") +
    "\nrunPasswordChange(process.argv[1]);";
  const invoke = (input: string, username = "vitoria") =>
    spawnSync(
      process.execPath,
      [resolve("node_modules/tsx/dist/cli.mjs"), "--eval", source, username],
      { cwd: resolve("scripts"), env, input, encoding: "utf8" },
    );
  for (const input of ["", "short", "x".repeat(129), "x".repeat(1025)]) {
    const result = invoke(input);
    assert.equal(result.status, 1);
    assert(!result.stderr.includes(input.length > 0 ? input : "Prisma"));
  }
  const legacyBefore = await db.$queryRaw`SELECT * FROM auth_user`;
  const result = invoke(newPassword);
  assert.equal(result.status, 0, "stdin password command failed");
  assert(!result.stdout.includes(newPassword));
  assert(!result.stderr.includes(newPassword));
  const updated = await db.user.findUniqueOrThrow({
    where: { id: vitoria.id },
  });
  const account = await db.authAccount.findUniqueOrThrow({
    where: {
      providerId_accountId: { providerId: "credential", accountId: vitoria.id },
    },
  });
  assert.equal(updated.passwordHash, account.password);
  assert(verifyPassword(newPassword, account.password!));
  assert(!verifyPassword(oldPassword, account.password!));
  assert.equal(
    await db.authSession.count({ where: { userId: vitoria.id } }),
    0,
  );
  assert.equal(
    await db.loginAttempt.count({ where: { username: "vitoria" } }),
    0,
  );
  assert.deepEqual(
    await db.user.findUnique({ where: { id: other.id } }),
    other,
  );
  assert.equal(await db.authSession.count({ where: { userId: other.id } }), 1);
  assert.equal(
    await db.loginAttempt.count({ where: { username: "emiliano" } }),
    1,
  );
  assert.deepEqual(await db.$queryRaw`SELECT * FROM auth_user`, legacyBefore);
  const events = await db.auditEvent.findMany({
    where: { action: "password.reset" },
  });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].after, {
    username: "vitoria",
    revokedSessions: 1,
  });
  assert(!JSON.stringify(events).includes(updated.passwordHash));
  console.log(
    "PASS: stdin password reset, consistent credentials, revoked sessions, isolated audit, validation and transactional rollback.",
  );
}
