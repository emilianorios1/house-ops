import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { config } from "dotenv";
if (!existsSync(".git") || !existsSync("package.json"))
  throw new Error("Run from the dedicated worktree.");
mkdirSync(".private", { recursive: true });
mkdirSync("data/shared-documents", { recursive: true });
// Dedicated Next configuration, never overwrite the old worktree's .env.
if (!existsSync(".env.local")) {
  const slug = resolve(".")
    .split(/[\\/]/)
    .slice(-2)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  const port = await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("No local port available"));
      server.close(() => resolvePort(address.port));
    });
  });
  const password = randomBytes(24).toString("hex");
  writeFileSync(
    ".env.local",
    `DATABASE_URL=postgresql://house_ops:${password}@127.0.0.1:${port}/house_ops\nPOSTGRES_DB=house_ops\nPOSTGRES_USER=house_ops\nPOSTGRES_PASSWORD=${password}\nHOME_LAB_DEV_POSTGRES_PORT=${port}\nCOMPOSE_PROJECT_NAME=shared-${slug}\nAUTH_SECRET=${randomBytes(48).toString("hex")}\nAUTH_URL=http://localhost:3000\nDOCUMENT_STORE_PATH=data/shared-documents\nHOUSE_OPS_ADMIN_PASSWORD=${randomBytes(18).toString("hex")}\nHOUSE_OPS_SECOND_PASSWORD=${randomBytes(18).toString("hex")}\n`,
    { mode: 0o600 },
  );
  chmodSync(".env.local", 0o600);
}
config({ path: ".env.local", quiet: true, override: true });
function run(command: string, args: string[]) {
  const r = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32" && command === "npm",
  });
  if (r.status !== 0) throw new Error(`Failed: ${command} ${args.join(" ")}`);
}
run("docker", [
  "compose",
  "--env-file",
  ".env.local",
  "up",
  "-d",
  "--wait",
  "postgres",
]);
run("npm", ["run", "db:generate"]);
run("npm", ["run", "db:migrate"]);
run("npm", ["run", "db:seed"]);
console.log(
  "Local PostgreSQL ready. Login instructions are in .private/local-login.txt (never commit it).",
);
