import { auth } from "@/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { db } from "@/lib/db";
import { cookies } from "next/headers";
const handlers = toNextJsHandler(auth);
const allowed = new Set(["get-session", "sign-in/email", "sign-out"]);
async function handle(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, "");
  if (!allowed.has(path)) return new Response(null, { status: 404 });
  if (path === "get-session" || path === "sign-out") {
    const session = await auth.api.getSession({
      headers: request.headers,
      query: { disableRefresh: true },
    });
    if (session) {
      const user = await db.user.findFirst({
        where: {
          id: session.user.id,
          active: true,
          username: { in: ["emiliano", "vitoria"] },
        },
      });
      if (!user) {
        await db.authSession.deleteMany({ where: { userId: session.user.id } });
        return Response.json(null, {
          headers: { "Cache-Control": "no-store" },
        });
      }
      if (
        path === "get-session" &&
        session.session.id.startsWith("maintenance-")
      )
        return Response.json(session, {
          headers: { "Cache-Control": "no-store" },
        });
      if (path === "sign-out" && request.method === "POST") {
        if (
          request.headers.get("origin") !==
          new URL(
            process.env.BETTER_AUTH_URL ?? process.env.AUTH_URL ?? request.url,
          ).origin
        )
          return new Response(null, { status: 403 });
        const jar = await cookies();
        const id = jar.get("casa-push-device")?.value;
        if (id)
          await db.pushSubscription.updateMany({
            where: { id, userId: user.id },
            data: { enabled: false },
          });
        jar.delete("casa-push-device");
      }
    }
  }
  return request.method === "GET"
    ? handlers.GET(request)
    : handlers.POST(request);
}
export const GET = handle;
export const POST = handle;
