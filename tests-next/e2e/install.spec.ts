import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { SESSION_MAX_AGE } from "../../src/lib/session-policy";
const db = new PrismaClient();
const url = new URL(process.env.DATABASE_URL!);
if (
  !url.pathname.startsWith("/house_ops_e2e_") ||
  !["localhost", "127.0.0.1"].includes(url.hostname)
)
  throw Error("Synthetic browser database required");
test.afterAll(() => db.$disconnect());
async function login(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("Contraseña")
    .fill(process.env.HOUSE_OPS_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Entrar a casa" }).click();
  await expect(page).toHaveURL(/\/$/);
}
test("install screen, persistent cookie, foreground renewal, offline and logout", async ({
  page,
  context,
  browser,
}, info) => {
  await login(page);
  const cookie = (await context.cookies()).find(
    (c) => c.name === "better-auth.session_token",
  )!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Lax");
  expect(cookie.expires - Date.now() / 1000).toBeGreaterThan(
    SESSION_MAX_AGE - 120,
  );
  const reopened = await browser.newContext({
    storageState: await context.storageState(),
  });
  try {
    const reopenedPage = await reopened.newPage();
    await reopenedPage.goto(new URL("/install", page.url()).href);
    await expect(
      reopenedPage.getByRole("heading", { name: "Tu sesión queda abierta" }),
    ).toBeVisible();
  } finally {
    await reopened.close();
  }
  await page.getByRole("link", { name: "Instalar y avisos" }).click();
  await expect(
    page.getByRole("heading", { name: "Tu sesión queda abierta" }),
  ).toBeVisible();
  if (info.project.name === "mobile")
    await expect(
      page.getByText("Primero agregá Casa a la pantalla de inicio", {
        exact: false,
      }),
    ).toBeVisible();
  else
    await expect(
      page.getByRole("button", { name: "Activar avisos" }),
    ).toBeVisible();
  const manifest = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.display).toBe("standalone");
  expect((await page.request.get("/icon-192.png")).status()).toBe(200);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.screenshot({
    path: `.private/previews/${info.project.name}-install-light.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Modo oscuro", exact: true }).click();
  await page.screenshot({
    path: `.private/previews/${info.project.name}-install-dark.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Simulate 89 days of inactivity without exposing or forging a session token.
  const user = await db.user.findUniqueOrThrow({
    where: { username: "emiliano" },
  });
  await db.authSession.updateMany({
    where: { userId: user.id },
    data: { expiresAt: new Date(Date.now() + 86_400_000) },
  });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect
    .poll(async () => {
      const latest = await db.authSession.findFirst({
        where: { userId: user.id },
        orderBy: { expiresAt: "desc" },
      });
      return latest!.expiresAt.getTime() - Date.now();
    })
    .toBeGreaterThan((SESSION_MAX_AGE - 120) * 1000);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Instalar y avisos." }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Casa está sin conexión" }),
  ).toBeVisible();
  await context.setOffline(false);
  await page.goto("/install");
  const origin = new URL(page.url()).origin;
  expect(
    (
      await page.request.post("/api/auth/sign-out", {
        headers: { origin },
        data: {},
      })
    ).status(),
  ).toBe(200);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get("/api/export")).status()).toBe(401);
});
test("expired/inactive sessions, public signup and untrusted push are rejected", async ({
  page,
}) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers: { origin },
        data: {},
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.post("/api/push", {
        headers: { origin: "https://evil.test" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/push", {
        headers: { origin },
        data: {
          subscription: {
            endpoint: "https://127.0.0.1/push",
            keys: { p256dh: "x", auth: "x" },
          },
        },
      })
    ).status(),
  ).toBe(400);
  const user = await db.user.findUniqueOrThrow({
    where: { username: "emiliano" },
  });
  await db.authSession.updateMany({
    where: { userId: user.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  expect(
    await (await page.request.get("/api/auth/get-session")).json(),
  ).toBeNull();
  await page.goto("/?month=2097-11");
  await expect(page).toHaveURL(/\/login\?month=2097-11/);
  await page
    .getByLabel("Contraseña")
    .fill(process.env.HOUSE_OPS_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Entrar a casa" }).click();
  await expect(page).toHaveURL(/\?month=2097-11/);
  try {
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    expect((await page.request.get("/api/export")).status()).toBe(401);
    expect(
      await (await page.request.get("/api/auth/get-session")).json(),
    ).toBeNull();
  } finally {
    await db.user.update({ where: { id: user.id }, data: { active: true } });
  }
});
test("device preferences, throttled test and logout revoke notifications", async ({
  page,
  context,
}) => {
  await login(page);
  await db.user.updateMany({
    where: { username: "emiliano" },
    data: { pushTestAt: null },
  });
  const origin = new URL(page.url()).origin;
  const data = {
    subscription: {
      endpoint: `https://fcm.googleapis.com/synthetic-${infoSafe()}`,
      keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
    },
  };
  expect(
    (
      await page.request.post("/api/push", { headers: { origin }, data })
    ).status(),
  ).toBe(200);
  const device = (await context.cookies()).find(
    (c) => c.name === "casa-push-device",
  )!;
  expect(device.httpOnly).toBe(true);
  expect(
    (
      await page.request.patch("/api/push", {
        headers: { origin },
        data: { reminders: false },
      })
    ).status(),
  ).toBe(200);
  expect(
    (await (await page.request.get("/api/push")).json()).device.reminders,
  ).toBe(false);
  expect(
    (
      await page.request.post("/api/push", {
        headers: { origin },
        data: { action: "test" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post("/api/push", {
        headers: { origin },
        data: { action: "test" },
      })
    ).status(),
  ).toBe(429);
  expect(
    (
      await page.request.post("/api/auth/sign-out", {
        headers: { origin },
        data: {},
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await db.pushSubscription.findUniqueOrThrow({
        where: { id: device.value },
      })
    ).enabled,
  ).toBe(false);
});
function infoSafe() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
test("installed app enables notifications only on tap and saves device choices", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true });
    let permission: NotificationPermission =
      sessionStorage.getItem("synthetic-permission") === "granted"
        ? "granted"
        : "default";
    Object.defineProperty(Notification, "permission", {
      get: () => permission,
    });
    Notification.requestPermission = async () => {
      permission = "granted";
      sessionStorage.setItem("synthetic-permission", "granted");
      return permission;
    };
    let subscription: PushSubscription | null = null;
    PushManager.prototype.getSubscription = async () => subscription;
    PushManager.prototype.subscribe = async () => {
      subscription = {
        toJSON: () => ({
          endpoint: `https://fcm.googleapis.com/browser-fixture-${Date.now()}`,
          keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
        }),
        unsubscribe: async () => {
          subscription = null;
          return true;
        },
      } as unknown as PushSubscription;
      return subscription;
    };
  });
  await login(page);
  await page.goto("/install");
  await expect(
    page.getByRole("heading", { name: "Casa ya está instalada" }),
  ).toBeVisible();
  expect(await page.evaluate(() => Notification.permission)).toBe("default");
  await page.getByRole("button", { name: "Activar avisos" }).click();
  await expect(
    page.getByText("Avisos activados", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Facturas por vencer", { exact: true }).uncheck();
  await expect(page.getByText("Guardamos tu preferencia.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("Facturas por vencer", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Desactivar avisos" }),
  ).toBeVisible();
  await page.screenshot({
    path: `.private/previews/${info.project.name}-install-enabled.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Desactivar avisos" }).click();
  await expect(
    page.getByText("Desactivaste los avisos en este teléfono."),
  ).toBeVisible();
});
