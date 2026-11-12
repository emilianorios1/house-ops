import { Prisma, type PrismaClient } from "@prisma/client";
import * as webpush from "web-push";
import { argentinaClock, retryAt, trustedPushEndpoint } from "./push-policy";
import { money } from "./money";
import { pushConfigured } from "./push-config";
export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  ttl: number;
};
export type PushSender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: PushPayload,
) => Promise<void>;
export const sendWebPush: PushSender = async (subscription, payload) => {
  if (!trustedPushEndpoint(subscription.endpoint))
    throw Object.assign(new Error("Untrusted push destination"), {
      statusCode: 410,
    });
  await webpush.sendNotification(subscription, JSON.stringify(payload), {
    timeout: 10_000,
    TTL: payload.ttl,
    vapidDetails: {
      subject: process.env.VAPID_SUBJECT!,
      publicKey: process.env.VAPID_PUBLIC_KEY!,
      privateKey: process.env.VAPID_PRIVATE_KEY!,
    },
  });
};
async function reminderPayload(tx: Prisma.TransactionClient, now: Date) {
  const clock = argentinaClock(now);
  const bills = await tx.expense.findMany({
    where: {
      archived: false,
      category: { not: "Internet" },
      dueDate: { in: [new Date(clock.date), new Date(clock.tomorrow)] },
    },
    include: { payments: true },
    orderBy: [{ dueDate: "asc" }, { title: "asc" }],
  });
  const pending = bills
    .map((bill) => ({
      ...bill,
      remaining:
        bill.amountCents -
        bill.payments
          .filter((p) => !p.voided)
          .reduce((sum, p) => sum + p.amountCents, 0n),
    }))
    .filter((bill) => bill.remaining > 0n);
  if (!pending.length) return null;
  const details = pending
    .slice(0, 3)
    .map(
      (bill) =>
        `${bill.title.slice(0, 60)}: ${money(bill.remaining)} (${bill.dueDate.toISOString().slice(0, 10) === clock.date ? "hoy" : "mañana"})`,
    );
  if (pending.length > 3) details.push(`y ${pending.length - 3} más`);
  return {
    title: "Facturas por vencer",
    body: details.join(" · "),
    month: pending[0].dueDate.toISOString().slice(0, 7),
  };
}
export async function notificationTick(
  db: PrismaClient,
  now = new Date(),
  send: PushSender = sendWebPush,
) {
  if (send === sendWebPush && !pushConfigured())
    return { configured: false, sent: 0, failed: 0 };
  return db.$transaction(
    async (tx) => {
      // One dispatcher owns the tick across replicas. DB releases this lock on crash.
      const [lock] = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(184732901) AS locked`;
      if (!lock.locked) return { configured: true, sent: 0, failed: 0 };
      const clock = argentinaClock(now);
      if (
        clock.hour >= 9 &&
        clock.hour < 12 &&
        (await reminderPayload(tx, now))
      ) {
        const users = await tx.user.findMany({
          where: { active: true, username: { in: ["emiliano", "vitoria"] } },
        });
        for (const user of users) {
          const subscriptions = await tx.pushSubscription.findMany({
            where: { userId: user.id, enabled: true, reminders: true },
          });
          if (!subscriptions.length) continue;
          const event = await tx.notificationEvent.upsert({
            where: { key: `reminder:${clock.date}:${user.id}` },
            create: {
              key: `reminder:${clock.date}:${user.id}`,
              userId: user.id,
              kind: "reminder",
              month: clock.date.slice(0, 7),
              title: "",
              body: "",
              expiresAt: clock.expiresAt,
            },
            update: {},
          });
          await tx.notificationDelivery.createMany({
            data: subscriptions.map((sub) => ({
              eventId: event.id,
              subscriptionId: sub.id,
            })),
            skipDuplicates: true,
          });
        }
      }
      const deliveries = await tx.notificationDelivery.findMany({
        where: { status: "pending", nextAttemptAt: { lte: now } },
        include: { event: true, subscription: true },
        orderBy: { nextAttemptAt: "asc" },
        take: 10,
      });
      let sent = 0,
        failed = 0;
      for (const delivery of deliveries) {
        const { event } = delivery;
        const sub = await tx.pushSubscription.findUniqueOrThrow({
          where: { id: delivery.subscriptionId },
        });
        const user = await tx.user.findFirst({
          where: {
            id: event.userId,
            active: true,
            username: { in: ["emiliano", "vitoria"] },
          },
        });
        const enabled =
          sub.enabled &&
          sub.userId === event.userId &&
          (event.kind === "test" ||
            (event.kind === "reminder" ? sub.reminders : sub.movements));
        const reminder =
          event.kind === "reminder" ? await reminderPayload(tx, now) : null;
        if (
          !user ||
          !enabled ||
          event.expiresAt <= now ||
          (event.kind === "reminder" && !reminder)
        ) {
          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: "skipped" },
          });
          continue;
        }
        const payload = {
          title: reminder?.title ?? event.title,
          body: reminder?.body ?? event.body,
          url: `/?month=${reminder?.month ?? event.month}`,
          tag: event.key,
          ttl: Math.max(
            1,
            Math.min(
              86400,
              Math.floor((event.expiresAt.getTime() - now.getTime()) / 1000),
            ),
          ),
        };
        try {
          await send(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
          );
          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: "sent",
              deliveredAt: now,
              attempts: { increment: 1 },
            },
          });
          sent++;
        } catch (error) {
          const status = Number(
            (error as { statusCode?: number }).statusCode ?? 0,
          );
          if (status === 404 || status === 410)
            await tx.pushSubscription.update({
              where: { id: sub.id },
              data: { enabled: false },
            });
          const permanent = status >= 400 && status < 500 && status !== 429;
          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: permanent ? "failed" : "pending",
              attempts: { increment: 1 },
              nextAttemptAt: retryAt(delivery.attempts + 1, now),
            },
          });
          failed++;
        }
      }
      return { configured: true, sent, failed };
    },
    { timeout: 150_000, maxWait: 5000 },
  );
}
