import { and, eq } from "drizzle-orm";
import { organisationMemberships, type TenantTransaction } from "@surveynt/db";
import { hasProfessionalPermission, type ProfessionalPermission } from "@surveynt/domain";
import type { SurveyContext } from "./surveys";

/** Lock and recheck the current membership before a professional write. Revocation
 * and role changes serialize with the write; stale cached request contexts confer no rights. */
export async function currentProfessionalPermission(tx: TenantTransaction, context: SurveyContext, permission: ProfessionalPermission) {
  if (!context.internalUserId) return false;
  const [membership] = await tx.select().from(organisationMemberships).where(and(
    eq(organisationMemberships.organisationId, context.organisationId),
    eq(organisationMemberships.userId, context.internalUserId),
    eq(organisationMemberships.active, true),
  )).for("share").limit(1);
  if (!membership || membership.role !== (context.actorRole??context.role)) return false;
  return hasProfessionalPermission(membership.role, permission,
    permission === "record_survey" ? membership.canRecordSurvey : membership.canApproveReports);
}
