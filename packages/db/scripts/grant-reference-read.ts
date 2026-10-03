import { sql } from "drizzle-orm";
import { auditEvents, createDatabase } from "../src/index";

async function main() {
  if (!process.env.DATABASE_APP_URL || !process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_APP_URL and DATABASE_ADMIN_URL are required.");
  const app = createDatabase(process.env.DATABASE_APP_URL); const admin = createDatabase(process.env.DATABASE_ADMIN_URL);
  const result = await app.execute(sql`select current_user as role`); const role = String((result.rows[0] as { role?: string } | undefined)?.role ?? "");
  if (!/^[a-zA-Z_][a-zA-Z0-9_$-]*$/.test(role)) throw new Error("The application login role name is invalid.");
  await admin.execute(sql.raw(`GRANT surveynt_reference_read TO "${role.replaceAll('"', '""')}"`));
  await admin.insert(auditEvents).values({ action: "property_data.reference_read_granted", resourceType: "database_role", resourceId: role, metadata: { groupRole: "surveynt_reference_read" } });
  console.log(JSON.stringify({ role, granted: "surveynt_reference_read" }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
