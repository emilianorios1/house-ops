import { z } from "zod";
export function trustedPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === "443") &&
      (url.hostname === "fcm.googleapis.com" ||
        url.hostname === "web.push.apple.com" ||
        url.hostname === "updates.push.services.mozilla.com" ||
        url.hostname.endsWith(".push.apple.com"))
    );
  } catch {
    return false;
  }
}
export const subscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(trustedPushEndpoint),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});
export function argentinaClock(now: Date) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const tomorrow = new Date(`${date}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return {
    date,
    tomorrow: tomorrow.toISOString().slice(0, 10),
    hour: Number(part("hour")),
    expiresAt: new Date(`${date}T12:00:00-03:00`),
  };
}
export function retryAt(attempt: number, now: Date) {
  return new Date(
    now.getTime() + Math.min(60, 2 ** Math.min(attempt, 6)) * 60_000,
  );
}
