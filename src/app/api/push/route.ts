import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { subscriptionSchema } from "@/lib/push-policy";
import { pushConfigured } from "@/lib/push-config";
const deviceSelect = {
  enabled: true,
  reminders: true,
  movements: true,
} as const;
async function context(request: Request, mutation = false) {
  const origin = new URL(
    process.env.BETTER_AUTH_URL ?? process.env.AUTH_URL ?? request.url,
  ).origin;
  if (mutation && request.headers.get("origin") !== origin) return null;
  const user = await currentUser();
  if (!user) return null;
  return { user, jar: await cookies() };
}
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  const ctx = await context(request);
  if (!ctx) return json({ error: "Ingresá a Casa." }, 401);
  const id = ctx.jar.get("casa-push-device")?.value;
  const device = id
    ? await db.pushSubscription.findFirst({
        where: { id, userId: ctx.user.id },
        select: deviceSelect,
      })
    : null;
  return json({
    configured: pushConfigured(),
    publicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    device,
  });
}
export async function POST(request: Request) {
  const ctx = await context(request, true);
  if (!ctx)
    return json({ error: "Ingresá a Casa desde su dirección habitual." }, 403);
  if (!pushConfigured())
    return json({ error: "Los avisos todavía no están configurados." }, 503);
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    return json({ error: "Solicitud demasiado grande." }, 413);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Revisá la solicitud." }, 400);
  }
  if (body?.action === "test") {
    const id = ctx.jar.get("casa-push-device")?.value;
    if (!id) return json({ error: "Activá los avisos primero." }, 400);
    const now = new Date();
    const result = await db.$transaction(async (tx) => {
      const sub = await tx.pushSubscription.findFirst({
        where: { id, userId: ctx.user.id, enabled: true },
      });
      if (!sub) return false;
      const allowed = await tx.user.updateMany({
        where: {
          id: ctx.user.id,
          OR: [
            { pushTestAt: null },
            { pushTestAt: { lte: new Date(now.getTime() - 60_000) } },
          ],
        },
        data: { pushTestAt: now },
      });
      if (!allowed.count) return false;
      await tx.notificationEvent.create({
        data: {
          key: `test:${ctx.user.id}:${now.getTime()}`,
          userId: ctx.user.id,
          kind: "test",
          month: now.toISOString().slice(0, 7),
          title: "Casa está cerca",
          body: "Los avisos ya funcionan en este teléfono.",
          expiresAt: new Date(now.getTime() + 10 * 60_000),
          deliveries: { create: { subscriptionId: id } },
        },
      });
      return true;
    });
    return result
      ? json({ ok: true })
      : json(
          { error: "Activá los avisos y esperá un minuto entre pruebas." },
          429,
        );
  }
  const parsed = subscriptionSchema.safeParse(body?.subscription);
  if (!parsed.success)
    return json(
      { error: "No pudimos reconocer los avisos de este teléfono." },
      400,
    );
  const { endpoint, keys } = parsed.data;
  const previous = await db.pushSubscription.findUnique({
    where: { endpoint },
  });
  if (previous && previous.userId !== ctx.user.id)
    return json(
      { error: "Desactivá los avisos anteriores y volvé a activarlos." },
      409,
    );
  const row = await db.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: ctx.user.id, endpoint, ...keys },
    update: { enabled: true, ...keys },
  });
  const oldId = ctx.jar.get("casa-push-device")?.value;
  if (oldId && oldId !== row.id)
    await db.pushSubscription.updateMany({
      where: { id: oldId, userId: ctx.user.id },
      data: { enabled: false },
    });
  ctx.jar.set("casa-push-device", row.id, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      new URL(
        process.env.BETTER_AUTH_URL ?? process.env.AUTH_URL ?? request.url,
      ).protocol === "https:",
    path: "/",
    maxAge: 365 * 24 * 3600,
  });
  return json({
    device: {
      enabled: row.enabled,
      reminders: row.reminders,
      movements: row.movements,
    },
  });
}
export async function PATCH(request: Request) {
  const ctx = await context(request, true);
  if (!ctx) return json({ error: "Ingresá a Casa." }, 403);
  let body;
  try {
    body = z
      .object({
        reminders: z.boolean().optional(),
        movements: z.boolean().optional(),
      })
      .strict()
      .parse(await request.json());
  } catch {
    return json({ error: "Revisá las preferencias." }, 400);
  }
  const id = ctx.jar.get("casa-push-device")?.value;
  if (!id) return json({ error: "Activá los avisos primero." }, 400);
  const result = await db.pushSubscription.updateMany({
    where: { id, userId: ctx.user.id, enabled: true },
    data: body,
  });
  if (!result.count) return json({ error: "Activá los avisos primero." }, 400);
  return json({
    device: await db.pushSubscription.findUnique({
      where: { id },
      select: deviceSelect,
    }),
  });
}
export async function DELETE(request: Request) {
  const ctx = await context(request, true);
  if (!ctx) return json({ error: "Ingresá a Casa." }, 403);
  const id = ctx.jar.get("casa-push-device")?.value;
  if (id)
    await db.pushSubscription.updateMany({
      where: { id, userId: ctx.user.id },
      data: { enabled: false },
    });
  ctx.jar.delete("casa-push-device");
  return json({ ok: true });
}
