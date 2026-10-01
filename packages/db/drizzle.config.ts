import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations/generated",
  dbCredentials: { url: process.env.DATABASE_ADMIN_URL ?? "postgresql://local:local@localhost:5432/surveynt" },
  strict: true,
});
