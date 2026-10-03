import { customerQuotes, createDatabase, withTenant } from "@surveynt/db";
import { desc, eq } from "drizzle-orm";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";

export async function GET(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required.");
  if (context.demo) return ok([], { demo: true });
  const rows = await withTenant(createDatabase(), context.organisationId, (tx) => tx.select().from(customerQuotes).where(eq(customerQuotes.organisationId, context.organisationId)).orderBy(desc(customerQuotes.updatedAt)).limit(100));
  return ok(rows);
}
