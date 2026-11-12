import { createMaintenanceSession } from "./maintenance-auth.mjs";
import { PrismaClient } from "@prisma/client";
import {
  randomBytes,
  createCipheriv,
  publicEncrypt,
  constants,
} from "node:crypto";
const db = new PrismaClient();
try {
  if (
    !process.env.UPLOAD_PUBLIC_KEY ||
    !(
      process.env.BETTER_AUTH_SECRET ??
      process.env.AUTH_SECRET ??
      process.env.HOUSE_OPS_SECRET_KEY
    )
  )
    throw Error("Upload session configuration required");
  const user = await db.user.findUniqueOrThrow({
    where: { username: "emiliano" },
  });
  if (!user.active) throw Error("Active household user required");
  const { cookie, token } = await createMaintenanceSession(db, user, 900);
  const key = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.from(
    JSON.stringify({
      cookie,
      token,
      origin: "https://casa.bordarteuniformes.com.ar",
      expiresAt: Date.now() + 900000,
    }),
  );
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const wrapped = publicEncrypt(
    {
      key: process.env.UPLOAD_PUBLIC_KEY,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    key,
  );
  // Only the encrypted envelope leaves the VPS; no permanent credentials change.
  process.stdout.write(
    JSON.stringify({
      key: wrapped.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      payload: encrypted.toString("base64"),
    }),
  );
} catch {
  console.error("Encrypted upload session could not be created.");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
