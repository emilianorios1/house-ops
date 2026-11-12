import { config } from "dotenv";
if (
  process.env.NODE_ENV !== "production" &&
  !process.env.HOUSE_OPS_DATABASE_OVERRIDE
)
  config({ path: ".private/push.env", quiet: true });
export function pushConfigured() {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT,
  );
}
