import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { SESSION_MAX_AGE } from "@/lib/session-policy";
export const auth = betterAuth({
  appName: "Casa",
  baseURL:
    process.env.BETTER_AUTH_URL ??
    process.env.AUTH_URL ??
    "http://localhost:3000",
  secret:
    process.env.BETTER_AUTH_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.HOUSE_OPS_SECRET_KEY,
  database: prismaAdapter(db, { provider: "postgresql", transaction: true }),
  user: { modelName: "AuthUser" },
  account: { modelName: "AuthAccount" },
  verification: { modelName: "AuthVerification" },
  session: {
    modelName: "AuthSession",
    expiresIn: SESSION_MAX_AGE,
    updateAge: 0,
    cookieCache: { enabled: false },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    password: {
      hash: async (password) => hashPassword(password),
      verify: async ({ password, hash }) => verifyPassword(password, hash),
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
      const username =
        email === "emiliano@casa.invalid"
          ? "emiliano"
          : email === "vitoria@casa.invalid"
            ? "vitoria"
            : null;
      if (!username)
        throw new APIError("UNAUTHORIZED", {
          message: "Revisá tu usuario y contraseña.",
        });
      const now = new Date();
      await db.loginAttempt.updateMany({
        where: {
          username,
          windowStart: { lt: new Date(now.getTime() - 15 * 60_000) },
        },
        data: { count: 0, windowStart: now },
      });
      const attempt = await db.loginAttempt.upsert({
        where: { username },
        create: { username, count: 1, windowStart: now },
        update: { count: { increment: 1 } },
      });
      if (attempt.count > 15)
        throw new APIError("TOO_MANY_REQUESTS", {
          message: "Esperá 15 minutos y volvé a intentar.",
        });
    }),
  },
  disabledPaths: [
    "/sign-up/email",
    "/change-password",
    "/set-password",
    "/request-password-reset",
    "/reset-password",
    "/change-email",
    "/update-user",
    "/delete-user",
  ],
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await db.user.findFirst({
            where: {
              id: session.userId,
              active: true,
              username: { in: ["emiliano", "vitoria"] },
            },
          });
          if (!user)
            throw new APIError("UNAUTHORIZED", {
              message: "No pudimos iniciar sesión.",
            });
          await db.loginAttempt.deleteMany({
            where: { username: user.username },
          });
          return { data: session };
        },
      },
    },
  },
  advanced: { defaultCookieAttributes: { httpOnly: true, sameSite: "lax" } },
  plugins: [nextCookies()],
});
