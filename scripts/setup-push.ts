import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as webpush from "web-push";
if (process.env.NODE_ENV === "production")
  throw Error(
    "Production key provisioning requires explicit operator approval.",
  );
const file = ".private/push.env";
if (existsSync(file))
  console.log("Local push configuration already exists; preserved.");
else {
  const keys = webpush.generateVAPIDKeys();
  mkdirSync(".private", { recursive: true });
  writeFileSync(
    file,
    `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=https://casa.bordarteuniformes.com.ar\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Local push configuration created in .private/push.env. Keys were not printed.",
  );
}
