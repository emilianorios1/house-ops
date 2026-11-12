import { config } from "dotenv";
config({
  path: ".env.local",
  quiet: true,
  override: !process.env.HOUSE_OPS_DATABASE_OVERRIDE,
});
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import assert from "node:assert/strict";
const rootUrl = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(rootUrl.hostname))
  throw Error("Local synthetic smoke only");
const root = new PrismaClient();
const name = `house_ops_container_test_${Date.now()}`;
const containerName = `casa-pwa-smoke-${Date.now()}`;
const image = process.env.CONTAINER_TEST_IMAGE ?? "house-ops-pwa-local:review";
const secret = randomBytes(48).toString("hex");
const password = randomBytes(24).toString("hex");
function docker(args: string[]) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0)
    throw Error("Synthetic container command failed (details suppressed)");
  return result.stdout.trim();
}
let started = false;
try {
  const postgres = docker([
    "compose",
    "--env-file",
    ".env.local",
    "ps",
    "-q",
    "postgres",
  ]);
  assert.ok(postgres);
  const network = docker([
    "inspect",
    "--format",
    "{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}",
    postgres,
  ]);
  assert.match(network, /^[a-f0-9]{64}$/);
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(Error("No port"));
      server.close(() => resolve(address.port));
    });
  });
  const origin = `http://localhost:${port}`;
  const url = new URL(rootUrl);
  url.hostname = "postgres";
  url.port = "5432";
  url.pathname = `/${name}`;
  const env = {
    ...process.env,
    DATABASE_URL: url.href,
    AUTH_SECRET: secret,
    AUTH_URL: origin,
    HOUSE_OPS_ADMIN_PASSWORD: password,
    HOUSE_OPS_SECOND_PASSWORD: password,
  };
  // Pass names, not secret values, on the Docker command line.
  const envArgs = Object.keys(env)
    .filter((k) =>
      [
        "DATABASE_URL",
        "AUTH_SECRET",
        "AUTH_URL",
        "HOUSE_OPS_ADMIN_PASSWORD",
        "HOUSE_OPS_SECOND_PASSWORD",
      ].includes(k),
    )
    .flatMap((k) => ["--env", k]);
  function run(args: string[]) {
    const result = spawnSync("docker", args, { env, encoding: "utf8" });
    if (result.status !== 0)
      throw Error("Synthetic image smoke failed (details suppressed)");
    return result.stdout.trim();
  }
  await root.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  run([
    "run",
    "--rm",
    "--network",
    network,
    ...envArgs,
    image,
    "npm",
    "run",
    "db:migrate",
  ]);
  run([
    "run",
    "--rm",
    "--network",
    network,
    ...envArgs,
    image,
    "npm",
    "run",
    "db:seed",
  ]);
  run([
    "run",
    "-d",
    "--name",
    containerName,
    "--network",
    network,
    "--read-only",
    "--tmpfs",
    "/tmp:mode=1777",
    "-p",
    `127.0.0.1:${port}:8000`,
    ...envArgs,
    image,
  ]);
  started = true;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin + "/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready);
  for (const path of [
    "/manifest.webmanifest",
    "/sw.js",
    "/icon-192.png",
    "/apple-touch-icon.png",
  ])
    assert.equal((await fetch(origin + path)).status, 200);
  assert.equal((await fetch(origin + "/api/export")).status, 401);
  const response = await fetch(origin + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "emiliano@casa.invalid",
      password,
      rememberMe: true,
    }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie);
  const session = await fetch(origin + "/api/auth/get-session", {
    headers: { cookie },
  });
  assert.equal((await session.json()).user.email, "emiliano@casa.invalid");
  assert.ok(
    session.headers
      .getSetCookie()
      .some(
        (value) =>
          value.includes("HttpOnly") && value.includes("Max-Age=7776000"),
      ),
  );
  const settings = await fetch(origin + "/install", { headers: { cookie } });
  assert.equal(settings.status, 200);
  assert.ok((await settings.text()).includes("Tu sesión queda abierta"));
  run([
    "run",
    "--rm",
    "--network",
    network,
    "--read-only",
    "--tmpfs",
    "/tmp:mode=1777",
    ...envArgs,
    image,
    "npm",
    "run",
    "notifications:work",
    "--",
    "--once",
  ]);
  console.log(
    "PASS: immutable image, synthetic migrations and login, 90-day cookie refresh, assets, protected settings, read-only web and notification worker.",
  );
} finally {
  if (started) docker(["rm", "-f", containerName]);
  await root.$executeRawUnsafe(
    `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
  );
  await root.$disconnect();
}
