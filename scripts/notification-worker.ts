import { config } from "dotenv";
if (process.env.NODE_ENV !== "production")
  config({
    path: ".env.local",
    quiet: true,
    override: !process.env.HOUSE_OPS_DATABASE_OVERRIDE,
  });
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notificationTick } from "../src/lib/notification-worker";
const db = new PrismaClient({ log: [] });
let stopped = false;
let wake: (() => void) | undefined;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopped = true;
    wake?.();
  });
try {
  do {
    try {
      const result = await notificationTick(db);
      writeFileSync(
        join(tmpdir(), "casa-notifications-health"),
        String(Date.now()),
      );
      console.log(JSON.stringify({ worker: "notifications", ...result }));
    } catch {
      console.error(
        JSON.stringify({ worker: "notifications", error: "tick_failed" }),
      );
    }
    if (process.argv.includes("--once") || stopped) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 60_000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  } while (!stopped);
} finally {
  await db.$disconnect();
}
