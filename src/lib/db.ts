import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
if (process.env.NODE_ENV !== "production")
  config({
    path: ".env.local",
    quiet: true,
    override: !process.env.HOUSE_OPS_DATABASE_OVERRIDE,
  });
const globalDb = globalThis as unknown as { db?: PrismaClient };
export const db = globalDb.db ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalDb.db = db;
