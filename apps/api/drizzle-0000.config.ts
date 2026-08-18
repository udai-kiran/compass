import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "/tmp/claude-1001/-home-udai-common-compass/7f424f9d-cabd-4ce5-bf0b-974d817b44fc/scratchpad/migrations-0000",
  dbCredentials: { url: process.env.DATABASE_URL },
});
