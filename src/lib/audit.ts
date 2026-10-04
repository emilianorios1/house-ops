import type { Prisma } from "@prisma/client";
export function snapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}
export function audit(
  tx: Prisma.TransactionClient,
  actor: string,
  action: string,
  entity: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  return tx.auditEvent.create({
    data: {
      actor,
      action,
      entity,
      entityId,
      ...(before ? { before: snapshot(before) } : {}),
      ...(after ? { after: snapshot(after) } : {}),
    },
  });
}
