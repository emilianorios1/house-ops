import { Prisma, PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

export function validatePasswordChange(username: string, password: string) {
  if (!["vitoria", "emiliano"].includes(username))
    throw new Error("Usuario inválido: elegí vitoria o emiliano.");
  if (
    password.length < 9 ||
    password.length > 128 ||
    /[\r\n\0]/.test(password)
  )
    throw new Error(
      "La contraseña debe tener entre 9 y 128 caracteres, sin saltos de línea.",
    );
}

export async function changePassword(
  db: PrismaClient,
  username: string,
  password: string,
) {
  validatePasswordChange(username, password);
  const passwordHash = hashPassword(password);
  return db.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({ where: { username } });
      if (!user?.active) throw new Error("Usuario inexistente o inactivo.");
      const identity = await tx.authUser.findUnique({ where: { id: user.id } });
      const accounts = await tx.authAccount.findMany({
        where: {
          OR: [
            { userId: user.id },
            { providerId: "credential", accountId: user.id },
          ],
        },
      });
      const account = accounts[0];
      if (
        identity?.email !== `${username}@casa.invalid` ||
        accounts.length !== 1 ||
        account.userId !== user.id ||
        account.accountId !== user.id ||
        account.providerId !== "credential" ||
        !account.password ||
        account.password !== user.passwordHash
      )
        throw new Error(
          "Los registros de acceso no coinciden; no se cambió la contraseña.",
        );

      const userChange = await tx.user.updateMany({
        where: { id: user.id, active: true, passwordHash: user.passwordHash },
        data: { passwordHash },
      });
      const accountChange = await tx.authAccount.updateMany({
        where: {
          id: account.id,
          password: account.password,
          updatedAt: account.updatedAt,
        },
        data: { password: passwordHash },
      });
      if (userChange.count !== 1 || accountChange.count !== 1)
        throw new Error(
          "El acceso cambió durante la operación; volvé a intentarlo.",
        );
      const sessions = await tx.authSession.deleteMany({
        where: { userId: user.id },
      });
      await tx.loginAttempt.deleteMany({ where: { username } });
      await tx.auditEvent.create({
        data: {
          actor: "maintenance:password-reset",
          action: "password.reset",
          entity: "user",
          entityId: user.id,
          after: { username, revokedSessions: sessions.count },
        },
      });
      return sessions.count;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

// Called explicitly by the VPS wrapper. Importing this module never opens a database.
export async function runPasswordChange(username: string) {
  let db: PrismaClient | undefined;
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 1024) throw new Error("Entrada demasiado larga.");
      chunks.push(bytes);
    }
    const password = Buffer.concat(chunks).toString("utf8");
    validatePasswordChange(username, password);
    if (!process.env.DATABASE_URL)
      throw new Error("Falta la conexión de la instalación.");
    db = new PrismaClient();
    const revoked = await changePassword(db, username, password);
    console.log(
      `Contraseña actualizada para ${username}. Sesiones cerradas: ${revoked}. Volvé a ingresar en tus dispositivos.`,
    );
  } catch {
    // Prisma errors may contain query arguments. Never print the original error.
    console.error(
      "No se cambió la contraseña. Revisá el usuario, la entrada y la consistencia de sus accesos; si hubo otra operación simultánea, volvé a intentar.",
    );
    process.exitCode = 1;
  } finally {
    await db?.$disconnect();
  }
}
