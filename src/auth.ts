import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
const dummyHash = hashPassword("constant-time-invalid-user");
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      async authorize(input) {
        const parsed = z
          .object({
            username: z.enum(["emiliano", "vitoria"]),
            password: z.string().min(1).max(256),
          })
          .safeParse(input);
        if (!parsed.success) return null;
        const { username, password } = parsed.data;
        const now = new Date();
        const windowStart = new Date(now.getTime() - 15 * 60 * 1000);
        await db.loginAttempt.updateMany({
          where: { username, windowStart: { lt: windowStart } },
          data: { count: 0, windowStart: now },
        });
        const attempt = await db.loginAttempt.upsert({
          where: { username },
          create: { username, count: 1, windowStart: now },
          update: { count: { increment: 1 } },
        });
        if (attempt.count > 15) return null;
        const user = await db.user.findUnique({ where: { username } });
        const valid = verifyPassword(password, user?.passwordHash ?? dummyHash);
        if (!valid || !user?.active) return null;
        await db.loginAttempt.deleteMany({ where: { username } });
        return { id: user.id, name: user.name, email: username };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.username = user.email;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.email = String(token.username);
      }
      return session;
    },
  },
});
