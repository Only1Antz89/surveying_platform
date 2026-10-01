import { createDatabase } from "@surveynt/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const timestamp = new Date().toISOString();
  if (!process.env.DATABASE_APP_URL && !process.env.DATABASE_URL) {
    return Response.json({ status: "ok", service: "surveynt-web", mode: "demo", timestamp });
  }

  try {
    await createDatabase().execute(sql`select 1`);
    return Response.json({ status: "ok", service: "surveynt-web", mode: "connected", timestamp });
  } catch {
    return Response.json({ status: "degraded", service: "surveynt-web", mode: "database_unavailable", timestamp }, { status: 503 });
  }
}
