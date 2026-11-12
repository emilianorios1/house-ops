import { auth } from "@/auth";
import { db } from "./db";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
export async function currentUser() {
  const session = await auth.api.getSession({
    headers: await headers(),
    query: { disableRefresh: true },
  });
  if (!session?.user?.id) return null;
  return db.user.findFirst({
    where: {
      id: session.user.id,
      active: true,
      username: { in: ["emiliano", "vitoria"] },
    },
  });
}
export async function requireUser(month?: string) {
  const user = await currentUser();
  if (!user)
    redirect(
      month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
        ? `/login?month=${month}`
        : "/login",
    );
  return user;
}
