import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import {
  notificationTick,
  type PushPayload,
  type PushSender,
} from "../src/lib/notification-worker";
import { enqueueMovement } from "../src/lib/notifications";
import { provisionAuthUsers } from "../src/lib/auth-provision";
export async function verifyNotifications(db: PrismaClient) {
  const emiliano = await db.user.findUniqueOrThrow({
    where: { username: "emiliano" },
  });
  const vitoria = await db.user.create({
    data: {
      username: "vitoria",
      name: "Synthetic Vitoria",
      passwordHash: "synthetic-unused-hash",
    },
  });
  await provisionAuthUsers(db);
  await provisionAuthUsers(db);
  assert.equal(
    (await db.authAccount.findFirstOrThrow({ where: { userId: emiliano.id } }))
      .password,
    emiliano.passwordHash,
  );
  const a = await db.pushSubscription.create({
    data: {
      userId: emiliano.id,
      endpoint: "https://fcm.googleapis.com/a",
      p256dh: "synthetic",
      auth: "synthetic",
    },
  });
  const b = await db.pushSubscription.create({
    data: {
      userId: vitoria.id,
      endpoint: "https://web.push.apple.com/b",
      p256dh: "synthetic",
      auth: "synthetic",
    },
  });
  const c = await db.pushSubscription.create({
    data: {
      userId: vitoria.id,
      endpoint: "https://fcm.googleapis.com/c",
      p256dh: "synthetic",
      auth: "synthetic",
      movements: false,
    },
  });
  const date = new Date("2096-12-31");
  const gas = await db.expense.create({
    data: {
      title: "Gas fixture",
      category: "Gas",
      dueDate: date,
      amountCents: 10000n,
      payments: {
        create: [
          { payer: "emiliano", amountCents: 2000n, paidAt: date },
          { payer: "vitoria", amountCents: 8000n, paidAt: date, voided: true },
        ],
      },
    },
  });
  await db.expense.createMany({
    data: [
      {
        title: "Tomorrow fixture",
        category: "Luz",
        dueDate: new Date("2097-01-01"),
        amountCents: 900n,
      },
      {
        title: "Hidden internet",
        category: "Internet",
        dueDate: date,
        amountCents: 900n,
      },
      {
        title: "Archived fixture",
        category: "Agua",
        dueDate: date,
        amountCents: 900n,
        archived: true,
      },
    ],
  });
  const received: PushPayload[] = [];
  const send: PushSender = async (_, payload) => {
    received.push(payload);
  };
  const morning = new Date("2096-12-31T12:00:00Z");
  await notificationTick(db, new Date("2096-12-31T11:59:00Z"), send);
  assert.equal(received.length, 0);
  await Promise.all([
    notificationTick(db, morning, send),
    notificationTick(db, morning, send),
  ]);
  assert.equal(received.length, 3);
  assert.ok(received.every((p) => p.ttl === 10800));
  assert.ok(
    received.every(
      (p) =>
        p.body.includes("Gas fixture") &&
        p.body.includes("mañana") &&
        !p.body.includes("Hidden") &&
        !p.body.includes("Archived"),
    ),
  );
  assert.ok(received[0].body.includes("80"));
  await notificationTick(db, morning, send);
  assert.equal(received.length, 3);
  // Rebuild pending reminder content after a payment, without stale financial payloads.
  await db.payment.create({
    data: {
      expenseId: gas.id,
      payer: "emiliano",
      amountCents: 8000n,
      paidAt: date,
    },
  });
  await db.notificationDelivery.updateMany({ data: { status: "pending" } });
  received.length = 0;
  await notificationTick(db, morning, send);
  assert.ok(received.every((p) => !p.body.includes("Gas fixture")));
  await db.$transaction(async (tx) => {
    await enqueueMovement(tx, {
      actor: "emiliano",
      entityId: "synthetic-payment",
      kind: "payment",
      month: "2096-12",
      amount: 150n,
      payer: "vitoria",
      concept: "Fixture payment",
    });
  });
  const movement = await db.notificationEvent.findFirstOrThrow({
    where: { kind: "movement" },
  });
  assert.equal(movement.userId, vitoria.id);
  assert.ok(movement.title.includes("Emiliano"));
  assert.ok(movement.body.includes("Vitoria"));
  assert.equal(
    await db.notificationDelivery.count({ where: { eventId: movement.id } }),
    1,
  );
  assert.equal(
    (
      await db.notificationDelivery.findFirstOrThrow({
        where: { eventId: movement.id },
      })
    ).subscriptionId,
    b.id,
  );
  await db.notificationEvent.update({
    where: { id: movement.id },
    data: { expiresAt: new Date("2097-01-01") },
  });
  let attempts = 0;
  await notificationTick(db, morning, async () => {
    attempts++;
    throw Object.assign(Error("synthetic"), { statusCode: 503 });
  });
  assert.equal(attempts, 1);
  await notificationTick(db, new Date(morning.getTime() + 60_000), send);
  let delivery = await db.notificationDelivery.findFirstOrThrow({
    where: { eventId: movement.id },
  });
  assert.equal(delivery.attempts, 1);
  assert.equal(delivery.status, "pending");
  await notificationTick(
    db,
    new Date(morning.getTime() + 120_000),
    async () => {
      throw Object.assign(Error("synthetic"), { statusCode: 410 });
    },
  );
  assert.equal(
    (await db.pushSubscription.findUniqueOrThrow({ where: { id: b.id } }))
      .enabled,
    false,
  );
  delivery = await db.notificationDelivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
  assert.equal(delivery.status, "failed");
  await assert.rejects(
    db.$transaction(async (tx) => {
      await enqueueMovement(tx, {
        actor: "vitoria",
        entityId: "rolled-back",
        kind: "settlement",
        month: "2096-12",
        amount: 100n,
        payer: "vitoria",
        concept: "Rollback",
      });
      throw Error("rollback");
    }),
  );
  assert.equal(
    await db.notificationEvent.count({
      where: { key: { contains: "rolled-back" } },
    }),
    0,
  );
  await db.notificationDelivery.updateMany({
    where: { subscriptionId: a.id },
    data: { status: "pending" },
  });
  received.length = 0;
  await notificationTick(db, new Date("2096-12-31T15:00:00Z"), send);
  assert.equal(received.length, 0);
  await db.pushSubscription.update({
    where: { id: c.id },
    data: { movements: true },
  });
  await db.$transaction((tx) =>
    enqueueMovement(tx, {
      actor: "emiliano",
      entityId: "inactive",
      kind: "payment",
      month: "2096-12",
      amount: 100n,
      payer: "emiliano",
      concept: "Inactive",
    }),
  );
  await db.user.update({ where: { id: vitoria.id }, data: { active: false } });
  await notificationTick(db, new Date(), send);
  assert.equal(received.length, 0);
  console.log(
    "PASS: notification recipients, Argentina reminders, balances, transactions, deduplication, concurrent dispatch, retries, expiry and inactive devices/users (simulated transport).",
  );
}
