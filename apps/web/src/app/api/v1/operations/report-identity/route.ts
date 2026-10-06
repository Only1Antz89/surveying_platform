import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auditEvents, createDatabase, organisationMemberships, organisationOperationalSettings, withTenant } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";

export async function PATCH(request: Request) {
  const session = await apiContext(request);
  if (!session) return problem(401, "unauthorised", "Sign in to your practice.");
  if (!isManagementRole(session.role) || !canWriteWorkspace(session)) return problem(403, "forbidden", "Management access to firm settings is required.");
  const parsed = z.object({ companyName: z.string().trim().max(160).optional(), address: z.string().trim().max(1000).optional(), email: z.union([z.email(), z.literal("")]).optional(), phone: z.string().trim().max(80).optional() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, "invalid_request", "Check the approved report identity.");
  if (session.demo) return ok(parsed.data, { persisted: false });
  const saved = await withTenant(createDatabase(), session.organisationId, async tx => {
    const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, session.organisationId), eq(organisationMemberships.userId, session.internalUserId!), eq(organisationMemberships.active, true))).for("share").limit(1);
    if (!member || member.role !== session.role || !isManagementRole(member.role)) return false;
    await tx.insert(organisationOperationalSettings).values({ organisationId: session.organisationId, reportIdentity: parsed.data }).onConflictDoUpdate({ target: organisationOperationalSettings.organisationId, set: { reportIdentity: parsed.data, updatedAt: new Date() } });
    await tx.insert(auditEvents).values({ organisationId: session.organisationId, actorUserId: session.internalUserId, action: "firm.report_identity_updated", resourceType: "organisation", resourceId: session.organisationId, metadata: { fields: Object.keys(parsed.data) } });
    return true;
  });
  return saved ? ok({ saved: true }) : problem(403, "forbidden", "Your settings permission changed.");
}
