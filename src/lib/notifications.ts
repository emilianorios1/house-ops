import type { Prisma } from "@prisma/client";
import { money } from "./money";
export async function enqueueMovement(
  tx: Prisma.TransactionClient,
  input: {
    actor: string;
    entityId: string;
    kind: "payment" | "settlement";
    month: string;
    amount: bigint;
    concept: string;
    payer: string;
  },
) {
  const users = await tx.user.findMany({
    where: {
      active: true,
      username: { in: ["emiliano", "vitoria"], not: input.actor },
    },
  });
  const actor = input.actor === "vitoria" ? "Vitoria" : "Emiliano";
  const payer = input.payer === "vitoria" ? "Vitoria" : "Emiliano";
  for (const user of users) {
    const subscriptions = await tx.pushSubscription.findMany({
      where: { userId: user.id, enabled: true, movements: true },
      select: { id: true },
    });
    if (!subscriptions.length) continue;
    await tx.notificationEvent.create({
      data: {
        key: `${input.kind}:${input.entityId}:${user.id}`,
        userId: user.id,
        kind: "movement",
        month: input.month,
        title: `${actor} registró ${input.kind === "payment" ? "un pago" : "un reintegro"}`,
        body: `${input.concept} · ${money(input.amount)} · ${input.kind === "payment" ? "Pagó" : "Transfirió"}: ${payer}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        deliveries: {
          create: subscriptions.map((s) => ({ subscriptionId: s.id })),
        },
      },
    });
  }
}
