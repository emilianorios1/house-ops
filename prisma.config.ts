import { config } from "dotenv";
import { defineConfig } from "prisma/config";
config({
  path: ".env.local",
  quiet: true,
  override: !process.env.HOUSE_OPS_DATABASE_OVERRIDE,
});
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
});
