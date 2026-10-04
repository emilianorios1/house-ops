import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", app: "house-ops", version: "2.0.0" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
