import { auth } from "@/auth";
import { db } from "./db";
import { redirect } from "next/navigation";
export async function currentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return db.user.findFirst({
    where: {
      id: session.user.id,
      active: true,
      username: { in: ["emiliano", "vitoria"] },
    },
  });
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
