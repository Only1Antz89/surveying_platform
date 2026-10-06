import { and, eq } from "drizzle-orm";
import { organisations, organisationOperationalSettings, type TenantTransaction } from "@surveynt/db";

export async function wholeFormEvidenceEnabled(tx: TenantTransaction, organisationId: string) {
  const [row] = await tx.select({ enabled: organisationOperationalSettings.surveyEvidenceEnabled }).from(organisationOperationalSettings).innerJoin(organisations, eq(organisations.id, organisationOperationalSettings.organisationId)).where(and(eq(organisations.id, organisationId), eq(organisations.isDemo, true), eq(organisations.status, "active"))).limit(1);
  return row?.enabled === true;
}
