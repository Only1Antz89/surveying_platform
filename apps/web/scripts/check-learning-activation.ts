import { createDatabase } from "@surveynt/db";
import { learningActivationReadiness } from "../src/lib/learning-readiness";

// Read-only: reports what shared learning still needs. Requires DATABASE_ADMIN_URL.
async function main() {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for this read-only check.");
  const result = await learningActivationReadiness(createDatabase(process.env.DATABASE_ADMIN_URL));
  console.log(JSON.stringify(result, null, 2));
  if (!result.prerequisitesMet) process.exitCode = 2;
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
