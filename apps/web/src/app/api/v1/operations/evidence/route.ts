import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auditEvents, createDatabase, organisationMemberships, organisationOperationalSettings, organisations, withTenant } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";

export async function PATCH(request: Request) {
  const session = await apiContext(request);
  if (!session) return problem(401, "unauthorised", "Sign in to your practice.");
  if (session.role !== "owner" || session.demo || !canWriteWorkspace(session)) return problem(403, "owner_required", "Only the private demo's owner can change this release flag.");
  const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, "invalid_request", "Choose whether to enable demo evidence collection.");
  const result = await withTenant(createDatabase(), session.organisationId, async tx => {
    const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, session.organisationId), eq(organisationMemberships.userId, session.internalUserId!), eq(organisationMemberships.active, true))).for("share").limit(1);
    const [org] = await tx.select().from(organisations).where(eq(organisations.id, session.organisationId)).for("share").limit(1);
    if (member?.role !== "owner" || !org?.isDemo || org.status !== "active") return null;
    const [settings] = await tx.update(organisationOperationalSettings).set({ surveyEvidenceEnabled: parsed.data.enabled, updatedAt: new Date() }).where(eq(organisationOperationalSettings.organisationId, session.organisationId)).returning({ enabled: organisationOperationalSettings.surveyEvidenceEnabled });
    if (!settings) return null;
    await tx.insert(auditEvents).values({ organisationId: session.organisationId, actorUserId: session.internalUserId, action: "evidence.demo_flag_changed", resourceType: "organisation", resourceId: session.organisationId, metadata: { enabled: parsed.data.enabled } });
    return settings;
  });
  return result ? ok(result) : problem(403, "demo_required", "This release is restricted to active private demos with operations settings.");
}
