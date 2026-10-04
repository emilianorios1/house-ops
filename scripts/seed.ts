import { config } from "dotenv";
config({
  path: ".env.local",
  quiet: true,
  override: !process.env.HOUSE_OPS_DATABASE_OVERRIDE,
});
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { mkdirSync, writeFileSync } from "node:fs";
const db = new PrismaClient();
async function main() {
  const credentials: string[] = [];
  for (const [username, name, key] of [
    ["emiliano", "Emiliano", "HOUSE_OPS_ADMIN_PASSWORD"],
    ["vitoria", "Vitoria", "HOUSE_OPS_SECOND_PASSWORD"],
  ]) {
    if (await db.user.findUnique({ where: { username } })) continue;
    const password = process.env[key];
    if (!password || password.length < 12)
      throw new Error(
        `Set a unique password of at least 12 characters in ${key}.`,
      );
    await db.user.create({
      data: { username, name, passwordHash: hashPassword(password) },
    });
    if (
      process.env.NODE_ENV !== "production" &&
      !process.env.HOUSE_OPS_DATABASE_OVERRIDE
    )
      credentials.push(`${name}: ${username}\nContraseña: ${password}`);
  }
  if (credentials.length) {
    mkdirSync(".private", { recursive: true });
    writeFileSync(
      ".private/local-login.txt",
      `http://localhost:3000\n\n${credentials.join("\n\n")}\n`,
      { mode: 0o600 },
    );
  }
  console.log("Household users ready (existing passwords preserved).");
}
main().finally(() => db.$disconnect());
