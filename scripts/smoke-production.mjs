import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { encode } from "@auth/core/jwt";
import { createHash } from "node:crypto";
const base = "https://casa.bordarteuniformes.com.ar";
const db = new PrismaClient();
const cookies = new Map();
let phase = "public-health";
let lastStatus;
async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    redirect: "manual",
    headers: {
      ...options.headers,
      ...(cookies.size
        ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
        : {}),
    },
  });
  lastStatus = response.status;
  for (const value of response.headers.getSetCookie()) {
    const first = value.split(";")[0];
    const pos = first.indexOf("=");
    cookies.set(first.slice(0, pos), first.slice(pos + 1));
  }
  return response;
}
try {
  assert.equal((await fetch(base + "/health")).status, 200);
  phase = "private-access-boundary";
  assert.equal((await fetch(base + "/api/export")).status, 401);
  phase = "active-user";
  const user = await db.user.findUniqueOrThrow({
    where: { username: "emiliano" },
  });
  assert.ok(user.active);
  if (process.argv.includes("--maintenance-session")) {
    // Short-lived server-side verification only; the token never leaves this process.
    const cookie = "__Secure-authjs.session-token";
    cookies.set(
      cookie,
      await encode({
        token: { sub: user.id, username: user.username, name: user.name },
        secret: process.env.AUTH_SECRET,
        salt: cookie,
        maxAge: 120,
      }),
    );
  } else {
    phase = "login-csrf";
    assert.ok(
      process.env.HOUSE_OPS_ADMIN_PASSWORD,
      "Configured production login required",
    );
    const csrf = await request("/api/auth/csrf");
    const { csrfToken } = await csrf.json();
    phase = "password-login";
    const response = await request("/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        origin: base,
      },
      body: new URLSearchParams({
        username: "emiliano",
        password: process.env.HOUSE_OPS_ADMIN_PASSWORD,
        csrfToken,
        callbackUrl: base,
      }),
    });
    assert.ok([200, 302, 303].includes(response.status));
  }
  phase = "authenticated-session";
  const session = await request("/api/auth/session");
  assert.equal((await session.json()).user?.email, "emiliano");
  const months = await db.rent.findMany({ select: { month: true } });
  phase = "monthly-page";
  for (const { month } of months) {
    const page = await request("/?month=" + month);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes("Un mes, cuentas claras"));
  }
  const documents = await db.document.findMany({
    where: {
      expenses: { some: { archived: false, category: { not: "Internet" } } },
    },
    select: { id: true, sha256: true },
  });
  phase = "original-pdf";
  for (const doc of documents) {
    const response = await request("/api/documents/" + doc.id);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), doc.sha256);
  }
  console.log(
    `PASS: canonical HTTPS domain, private access boundary, ${process.argv.includes("--maintenance-session") ? "authenticated maintenance session" : "existing password login"}, ${months.length} rent months and ${documents.length} original PDFs.`,
  );
} catch {
  console.error(JSON.stringify({error: "Production smoke failed", phase, status:lastStatus}));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
