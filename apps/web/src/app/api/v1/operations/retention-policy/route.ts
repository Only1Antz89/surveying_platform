import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { auditEvents, createDatabase, organisationMemberships, organisationOperationalSettings, withTenant } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { ok, parseBody, problem } from "@/lib/api";
import { surveyFileRetentionPolicy } from "@/lib/survey-file-retention";

const input = z.object({ expectedRevision: z.number().int().min(0), policyVersion: z.literal(surveyFileRetentionPolicy.version), enabled: z.boolean(), reason: z.string().trim().min(10).max(2000), confirmed: z.literal(true) }).strict();
export async function PATCH(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in to review the practice retention policy.");
  const denial = await workspaceApiGuard(request, context); if (denial) return denial;
  if (!isManagementRole(context.role) || !canWriteWorkspace(context)) return problem(403, "forbidden", "Practice management access is required.");
  const parsed = await parseBody(request, input);
  if (!parsed.success) return problem(400, "invalid_request", "Review the one-year policy, record your reason and confirm the decision.");
  if (context.demo) return ok({ persisted: false });
  return withTenant(createDatabase(), context.organisationId, async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`retention-policy:${context.organisationId}`},0))`);
    const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.userId, context.internalUserId!), eq(organisationMemberships.active, true))).for("share");
    if (!member || member.role !== context.role || !isManagementRole(member.role)) return problem(403, "forbidden", "Your policy approval permission changed.");
    const [settings] = await tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, context.organisationId)).for("update");
    const previous = settings?.surveyFileRetentionPolicy ?? null;
    if ((previous?.revision ?? 0) !== parsed.data.expectedRevision) return problem(409, "policy_changed", "Reload and review the current practice policy.");
    const policy = { version: surveyFileRetentionPolicy.version, revision: (previous?.revision ?? 0) + 1, enabled: parsed.data.enabled, approvedAt: new Date().toISOString(), approvedByUserId: member.userId, reason: parsed.data.reason };
    await tx.insert(organisationOperationalSettings).values({ organisationId: context.organisationId, surveyFileRetentionPolicy: policy }).onConflictDoUpdate({ target: organisationOperationalSettings.organisationId, set: { surveyFileRetentionPolicy: policy, updatedAt: new Date() } });
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: member.userId, action: "firm.survey_retention_policy_reviewed", resourceType: "organisation", resourceId: context.organisationId, metadata: { previous, next: policy, years: 1, confirmed: true, automaticDeletion: false } });
    return ok({ policy, persisted: true, automaticDeletion: false });
  });
}
