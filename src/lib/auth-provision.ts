import type { PrismaClient } from "@prisma/client";
// Add missing identities only; repeated setup never resets an existing password.
export async function provisionAuthUsers(db: PrismaClient) {
  const users = await db.user.findMany({
    where: { username: { in: ["emiliano", "vitoria"] } },
  });
  for (const user of users)
    await db.$transaction(async (tx) => {
      await tx.authUser.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          name: user.name,
          email: `${user.username}@casa.invalid`,
        },
        update: {},
      });
      await tx.authAccount.upsert({
        where: {
          providerId_accountId: {
            providerId: "credential",
            accountId: user.id,
          },
        },
        create: {
          id: `credential-${user.id}`,
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: user.passwordHash,
        },
        update: {},
      });
    });
}
