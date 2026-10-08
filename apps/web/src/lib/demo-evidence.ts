import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { auditEvents, createDatabase, jobs, organisationMemberships, organisationOperationalSettings, organisations, preinspectionDrafts, preinspectionSubmissions, withTenant, type Database, type TenantTransaction } from "@surveynt/db";
import { PreinspectionError, writePreinspection, type PreinspectionStaff } from "./preinspection";

export async function requireDemoEvidenceOwner(tx: TenantTransaction, context: PreinspectionStaff) {
  const [member] = await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, context.organisationId), eq(organisationMemberships.userId, context.internalUserId ?? "00000000-0000-0000-0000-000000000000"), eq(organisationMemberships.active, true))).for("share").limit(1);
  if (!member || member.role !== "owner" || context.role !== "owner") throw new PreinspectionError(403, "owner_required", "Only a current practice owner can prepare evidence scenarios.");
  const [org] = await tx.select({ demo: organisations.isDemo, status: organisations.status, enabled: organisationOperationalSettings.surveyEvidenceEnabled }).from(organisations).innerJoin(organisationOperationalSettings, eq(organisationOperationalSettings.organisationId, organisations.id)).where(eq(organisations.id, context.organisationId)).for("share").limit(1);
  if (!org?.demo || org.status !== "active" || !org.enabled) throw new PreinspectionError(409, "demo_evidence_setup_required", "Enable whole-form evidence in the private demo's settings first.");
  return member;
}

/** Explicit demo operation: never modifies existing answers, permissions or survey templates. */
export async function seedDemoEvidence(context: PreinspectionStaff, db: Database = createDatabase()) {
  return withTenant(db, context.organisationId, async tx => {
    const member = await requireDemoEvidenceOwner(tx, context);
    // Job locks are shared with the customer/staff questionnaire writers.
    const scenarios = await tx.select().from(jobs).where(eq(jobs.organisationId, context.organisationId)).orderBy(desc(jobs.reference)).for("update");
    const prepared: { jobId: string; reference: string }[] = [];
    let skipped = 0;
    for (const job of scenarios) {
      if (job.stage === "archived") continue;
      const [draft] = await tx.select({ id: preinspectionDrafts.id }).from(preinspectionDrafts).where(and(eq(preinspectionDrafts.organisationId, context.organisationId), eq(preinspectionDrafts.jobId, job.id))).limit(1);
      const [submission] = await tx.select({ id: preinspectionSubmissions.id }).from(preinspectionSubmissions).where(and(eq(preinspectionSubmissions.organisationId, context.organisationId), eq(preinspectionSubmissions.jobId, job.id))).limit(1);
      if (draft || submission) { skipped++; continue; }
      const valuation = /valuation/i.test(job.serviceName);
      await writePreinspection(tx, { organisationId: context.organisationId, jobId: job.id, propertyId: job.propertyId, actorUserId: member.userId, source: "staff_transcribed_client", valuation }, {
        version: 0, requestId: crypto.randomUUID(), answers: {
          occupancy: "Fictional demo statement: owner occupied; confirm during inspection.",
          access: "Fictional demo statement: customer will meet the surveyor; loft access to be checked.",
          concerns: "Fictional demo statement: please inspect reported staining near the rear window.",
          propertyType: "Fictional demo statement: terraced house (verify against property records).",
          approximateBuildYear: 1900,
          accommodation: "Fictional demo statement: three bedrooms and two reception rooms; not a measured layout.",
          services: "Fictional demo statement: gas heating; no claim about safety or present operation.",
          alterations: "Fictional demo statement: a rear extension is reported; completion year is unknown.",
          documentsAvailable: "Fictional demo statement: completion certificate requested, not supplied. Upload a labelled test document to exercise evidence review.",
          boundaries: "Fictional demo statement: fence at rear; ownership and legal boundary are unconfirmed.",
          ...(valuation ? { agreedPurchasePriceMinor: 42500000 } : {}),
        },
      }, true);
      prepared.push({ jobId: job.id, reference: job.reference });
    }
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: member.userId, action: "demo.evidence_prepared", resourceType: "organisation", resourceId: context.organisationId, metadata: { prepared: prepared.length, skipped, simulated: true } });
    return { prepared, skipped, demo: true, message: "Fictional customer statements prepared. Existing answers, survey findings, permissions and templates are unchanged." };
  });
}
