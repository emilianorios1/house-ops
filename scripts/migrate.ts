import { config } from "dotenv";
config({
  path: ".env.local",
  quiet: true,
  override: !process.env.HOUSE_OPS_DATABASE_OVERRIDE,
});
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
const db = new PrismaClient();
function cli(args: string[]) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", ...args],
    { stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) throw new Error("Migration command failed.");
}
async function main() {
  const [state] = await db.$queryRaw<
    { legacy: boolean; managed: boolean }[]
  >`SELECT to_regclass('public.auth_user') IS NOT NULL AS legacy, to_regclass('public._prisma_migrations') IS NOT NULL AS managed`;
  if (state.legacy && !state.managed)
    cli(["migrate", "resolve", "--applied", "0_baseline"]);
  cli(["migrate", "deploy"]);
}
main().finally(() => db.$disconnect());
