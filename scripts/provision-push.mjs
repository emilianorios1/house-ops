import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { generateVAPIDKeys, getVapidHeaders } from "web-push";
export function provisionPush(file) {
  if (existsSync(file)) {
    if ((statSync(file).mode & 0o077) !== 0 && process.platform !== "win32")
      throw Error("Push configuration must be private.");
    const values = parse(readFileSync(file));
    getVapidHeaders(
      "https://web.push.apple.com",
      values.VAPID_SUBJECT,
      values.VAPID_PUBLIC_KEY,
      values.VAPID_PRIVATE_KEY,
      "aes128gcm",
    );
    return "preserved";
  }
  const keys = generateVAPIDKeys();
  writeFileSync(
    file,
    `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=https://casa.bordarteuniformes.com.ar\n`,
    { mode: 0o600, flag: "wx" },
  );
  return "created";
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (!process.argv[2]) throw Error("Private destination required");
    console.log(
      `VPS push configuration ${provisionPush(process.argv[2])}; keys were not printed.`,
    );
  } catch {
    console.error(
      "Push configuration could not be provisioned; existing credentials were preserved.",
    );
    process.exitCode = 1;
  }
}
