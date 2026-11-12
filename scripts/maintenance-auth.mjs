// Server-only operator helper. Never mounted in the application router.
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { randomUUID } from "node:crypto";
export async function createMaintenanceSession(db, user, seconds) {
  if (!user.active || !["emiliano", "vitoria"].includes(user.username))
    throw Error("Active household user required");
  await db.authUser.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      name: user.name,
      email: `${user.username}@casa.invalid`,
    },
    update: {},
  });
  const instance = betterAuth({
    baseURL: "https://casa.bordarteuniformes.com.ar",
    secret:
      process.env.BETTER_AUTH_SECRET ??
      process.env.AUTH_SECRET ??
      process.env.HOUSE_OPS_SECRET_KEY,
    database: prismaAdapter(db, { provider: "postgresql" }),
    user: { modelName: "AuthUser" },
    account: { modelName: "AuthAccount" },
    verification: { modelName: "AuthVerification" },
    session: {
      modelName: "AuthSession",
      expiresIn: seconds,
      disableSessionRefresh: true,
    },
    advanced: {
      database: {
        generateId: ({ model }) =>
          `${model === "session" ? "maintenance-" : ""}${randomUUID()}`,
      },
    },
    plugins: [
      {
        id: "operator-only",
        endpoints: {
          maintenance: createAuthEndpoint(
            "/operator-session",
            { method: "POST" },
            async (ctx) => {
              const identity = await db.authUser.findUniqueOrThrow({
                where: { id: user.id },
              });
              const session = await ctx.context.internalAdapter.createSession(
                user.id,
                false,
              );
              await setSessionCookie(ctx, { session, user: identity });
              return ctx.json({ id: session.id, expiresAt: session.expiresAt });
            },
          ),
        },
      },
    ],
  });
  const response = await instance.api.maintenance({ asResponse: true });
  const header = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Secure-better-auth.session_token="));
  if (!response.ok || !header)
    throw Error("Maintenance session could not be created");
  const first = header.split(";")[0];
  const separator = first.indexOf("=");
  return {
    cookie: first.slice(0, separator),
    token: first.slice(separator + 1),
    ...(await response.json()),
  };
}
