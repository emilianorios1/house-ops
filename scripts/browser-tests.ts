import { config } from "dotenv";
config({
  path: ".env.local",
  quiet: true,
  override: !process.env.HOUSE_OPS_DATABASE_OVERRIDE,
});
import { PrismaClient } from "@prisma/client";
import { spawn, spawnSync } from "node:child_process";
const rootUrl = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(rootUrl.hostname))
  throw new Error("Browser fixtures must use an isolated local database.");
const rootDb = new PrismaClient();
const name = `house_ops_e2e_${Date.now()}`;
const url = new URL(rootUrl);
url.pathname = `/${name}`;
const port = process.env.E2E_TEST_PORT ?? "3100";
const env = {
  ...process.env,
  HOUSE_OPS_DATABASE_OVERRIDE: "1",
  HOUSE_OPS_TEST_BUILD_DIR: ".private/next-e2e",
  DATABASE_URL: url.href,
  AUTH_URL: `http://localhost:${port}`,
  E2E_BASE_URL: `http://localhost:${port}`,
  NEXT_TELEMETRY_DISABLED: "1",
};
function run(args: string[]) {
  const r = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (r.status !== 0) throw new Error("Browser validation command failed.");
}
async function main() {
  await rootDb.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  let server: ReturnType<typeof spawn> | undefined;
  try {
    run(["--import", "tsx", "scripts/migrate.ts"]);
    run(["--import", "tsx", "scripts/seed.ts"]);
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        port,
      ],
      { env, stdio: "ignore" },
    );
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        const r = await fetch(`http://localhost:${port}/health`);
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!ready) throw new Error("Isolated browser app did not become ready.");
    const result = spawnSync(
      process.execPath,
      ["node_modules/@playwright/test/cli.js", "test"],
      { env, stdio: "inherit" },
    );
    process.exitCode = result.status ?? 1;
  } finally {
    if (server) {
      const exited = new Promise<void>((r) => server!.once("exit", () => r()));
      server.kill();
      await exited;
    }
    await rootDb.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await rootDb.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Isolated browser verification failed; household records were not used.",
  );
  process.exitCode = 1;
});
