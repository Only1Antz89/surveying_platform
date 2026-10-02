import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { aiUses, evaluateAiGate, getGovernedModel, type AiGateResult, type AiUse } from "@surveynt/assistant";
import { aiConsentRecords, aiIncidents, aiModelRegister, aiRiskAssessments, auditEvents, createDatabase, jobs, organisationAiSettings, withTenant, type TenantTransaction } from "@surveynt/db";
import { canManageTeam, canMutateOperations, type OrganisationRole } from "@surveynt/domain";

export type GovernanceContext = { organisationId: string; internalUserId: string | null; role: OrganisationRole };

export class GovernanceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const today = () => new Date().toISOString().slice(0, 10);
const audit = (tx: TenantTransaction, context: GovernanceContext, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown> = {}) =>
  tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action, resourceType, resourceId, metadata });

/** Evaluates the governance gate for one use on one job, inside the caller's tenant transaction. */
export async function loadAiGate(tx: TenantTransaction, organisationId: string, jobId: string, use: AiUse, env = process.env): Promise<AiGateResult> {
  const [register, [settings], assessments, [consent], incidents] = await Promise.all([
    tx.select({ providerKey: aiModelRegister.providerKey, modelId: aiModelRegister.modelId, modelVersion: aiModelRegister.modelVersion, uses: aiModelRegister.uses, status: aiModelRegister.status }).from(aiModelRegister),
    tx.select().from(organisationAiSettings).where(eq(organisationAiSettings.organisationId, organisationId)).limit(1),
    tx.select({ use: aiRiskAssessments.use, status: aiRiskAssessments.status, reviewDue: aiRiskAssessments.reviewDue }).from(aiRiskAssessments).where(and(eq(aiRiskAssessments.organisationId, organisationId), eq(aiRiskAssessments.status, "approved"))),
    tx.select().from(aiConsentRecords).where(and(eq(aiConsentRecords.organisationId, organisationId), eq(aiConsentRecords.jobId, jobId))).orderBy(desc(aiConsentRecords.createdAt)).limit(1),
    tx.select({ severity: aiIncidents.severity, status: aiIncidents.status }).from(aiIncidents).where(and(eq(aiIncidents.organisationId, organisationId), inArray(aiIncidents.status, ["open", "investigating"]))),
  ]);
  return evaluateAiGate({
    providerKey: env.AI_PROVIDER ?? "none", register,
    settings: settings ? { aiFeaturesEnabled: settings.aiFeaturesEnabled, permittedUses: settings.permittedUses, disclosureVersion: settings.disclosureVersion } : null,
    riskAssessments: assessments, consent: consent ? { status: consent.status, uses: consent.uses, disclosureVersion: consent.disclosureVersion } : null,
    openIncidents: incidents, today: today(),
  }, use);
}

/**
 * The only way application code may obtain an assistant model: the governance
 * gate runs first, and a blocked use gets a model that reports "unavailable"
 * with the reasons. (An ESLint rule forbids getAssistantModel elsewhere.)
 */
export async function governedModelFor(context: Pick<GovernanceContext, "organisationId">, jobId: string, use: AiUse) {
  const gate = await withTenant(createDatabase(), context.organisationId, (tx) => loadAiGate(tx, context.organisationId, jobId, use));
  return { gate, model: getGovernedModel(process.env, gate) };
}

// Firm settings, risk assessments and incidents.

export const settingsInput = z.object({
  aiFeaturesEnabled: z.boolean(),
  permittedUses: z.array(z.enum(aiUses)).max(aiUses.length),
  disclosureText: z.string().trim().min(40).max(4000).nullable(),
  version: z.number().int().nonnegative(),
}).refine((input) => !input.aiFeaturesEnabled || Boolean(input.disclosureText), { message: "Write the disclosure clients will see before enabling AI features.", path: ["disclosureText"] });

export async function loadAiGovernance(context: Pick<GovernanceContext, "organisationId">) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [[settings], assessments, incidents, register] = await Promise.all([
      tx.select().from(organisationAiSettings).where(eq(organisationAiSettings.organisationId, context.organisationId)).limit(1),
      tx.select().from(aiRiskAssessments).where(eq(aiRiskAssessments.organisationId, context.organisationId)).orderBy(desc(aiRiskAssessments.createdAt)).limit(100),
      tx.select().from(aiIncidents).where(eq(aiIncidents.organisationId, context.organisationId)).orderBy(desc(aiIncidents.createdAt)).limit(100),
      tx.select({ providerKey: aiModelRegister.providerKey, modelId: aiModelRegister.modelId, modelVersion: aiModelRegister.modelVersion, uses: aiModelRegister.uses, status: aiModelRegister.status }).from(aiModelRegister).where(eq(aiModelRegister.status, "approved")),
    ]);
    return {
      providerConfigured: (process.env.AI_PROVIDER ?? "none") !== "none",
      settings: settings ? { aiFeaturesEnabled: settings.aiFeaturesEnabled, permittedUses: settings.permittedUses, disclosureText: settings.disclosureText, disclosureVersion: settings.disclosureVersion, version: settings.version } : { aiFeaturesEnabled: false, permittedUses: [], disclosureText: null, disclosureVersion: 0, version: 0 },
      assessments: assessments.map((row) => ({ id: row.id, use: row.use, title: row.title, summary: row.summary, risks: row.risks, status: row.status, reviewDue: row.reviewDue, approvedAt: row.approvedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() })),
      incidents: incidents.map((row) => ({ id: row.id, category: row.category, severity: row.severity, description: row.description, status: row.status, correctionNote: row.correctionNote, relatedRecord: row.relatedRecord, createdAt: row.createdAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null })),
      approvedModels: register,
    };
  });
}

/** Owners and administrators turn AI uses on or off. Changing the disclosure text makes earlier consents out of date. */
export async function updateAiSettings(context: GovernanceContext, input: z.infer<typeof settingsInput>) {
  if (!canManageTeam(context.role)) throw new GovernanceError(403, "forbidden", "Only owners and administrators can change AI settings.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [current] = await tx.select().from(organisationAiSettings).where(eq(organisationAiSettings.organisationId, context.organisationId)).limit(1);
    if ((current?.version ?? 0) !== input.version) throw new GovernanceError(409, "version_conflict", "The settings were changed by someone else. Reload and try again.");
    const disclosureChanged = (current?.disclosureText ?? null) !== input.disclosureText;
    const values = { aiFeaturesEnabled: input.aiFeaturesEnabled, permittedUses: input.permittedUses, disclosureText: input.disclosureText, disclosureVersion: (current?.disclosureVersion ?? 0) + (disclosureChanged && input.disclosureText ? 1 : 0), updatedByUserId: context.internalUserId, version: (current?.version ?? 0) + 1, updatedAt: new Date() };
    const [saved] = current
      ? await tx.update(organisationAiSettings).set(values).where(eq(organisationAiSettings.organisationId, context.organisationId)).returning()
      : await tx.insert(organisationAiSettings).values({ organisationId: context.organisationId, ...values }).returning();
    await audit(tx, context, "ai.settings_updated", "organisation_ai_settings", context.organisationId, { aiFeaturesEnabled: saved.aiFeaturesEnabled, permittedUses: saved.permittedUses, disclosureVersion: saved.disclosureVersion });
    return saved;
  });
}

export const riskAssessmentInput = z.object({
  use: z.enum(aiUses),
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(20).max(4000),
  risks: z.array(z.object({ risk: z.string().trim().min(3).max(500), likelihood: z.enum(["low", "medium", "high"]), impact: z.enum(["low", "medium", "high"]), mitigation: z.string().trim().min(3).max(1000) })).min(1).max(30),
  reviewDue: z.iso.date(),
});

export async function createRiskAssessment(context: GovernanceContext, input: z.infer<typeof riskAssessmentInput>) {
  if (!canMutateOperations(context.role)) throw new GovernanceError(403, "forbidden", "Your role cannot write risk assessments.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [created] = await tx.insert(aiRiskAssessments).values({ organisationId: context.organisationId, ...input, createdByUserId: context.internalUserId }).returning();
    await audit(tx, context, "ai.risk_assessment_created", "ai_risk_assessment", created.id, { use: input.use });
    return created;
  });
}

/** Approval supersedes any earlier approved assessment for the same use. Owners and administrators only. */
export async function approveRiskAssessment(context: GovernanceContext, id: string) {
  if (!canManageTeam(context.role) || !context.internalUserId) throw new GovernanceError(403, "forbidden", "Only owners and administrators can approve risk assessments.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [row] = await tx.select().from(aiRiskAssessments).where(and(eq(aiRiskAssessments.id, id), eq(aiRiskAssessments.organisationId, context.organisationId))).limit(1);
    if (!row) throw new GovernanceError(404, "not_found", "The risk assessment could not be found.");
    if (row.status !== "draft") throw new GovernanceError(409, "not_draft", "Only drafts can be approved.");
    await tx.update(aiRiskAssessments).set({ status: "superseded", updatedAt: new Date() }).where(and(eq(aiRiskAssessments.organisationId, context.organisationId), eq(aiRiskAssessments.use, row.use), eq(aiRiskAssessments.status, "approved")));
    const [approved] = await tx.update(aiRiskAssessments).set({ status: "approved", approvedByUserId: context.internalUserId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(aiRiskAssessments.id, id)).returning();
    await audit(tx, context, "ai.risk_assessment_approved", "ai_risk_assessment", id, { use: row.use });
    return approved;
  });
}

export const incidentInput = z.object({
  category: z.enum(["incorrect_output", "unsupported_claim", "privacy", "bias", "security", "availability", "other"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  description: z.string().trim().min(10).max(4000),
  jobId: z.uuid().nullable().optional(),
  relatedRecord: z.string().trim().max(200).nullable().optional(),
});

export async function reportAiIncident(context: GovernanceContext, input: z.infer<typeof incidentInput>) {
  if (!canMutateOperations(context.role)) throw new GovernanceError(403, "forbidden", "Your role cannot report incidents.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [created] = await tx.insert(aiIncidents).values({ organisationId: context.organisationId, category: input.category, severity: input.severity, description: input.description, jobId: input.jobId ?? null, relatedRecord: input.relatedRecord ?? null, reportedByUserId: context.internalUserId }).returning();
    await audit(tx, context, "ai.incident_reported", "ai_incident", created.id, { category: input.category, severity: input.severity });
    return created;
  });
}

/** Moves an incident on; "corrected" and "closed" need a note of what was corrected. Owners and administrators only. */
export async function updateAiIncident(context: GovernanceContext, id: string, input: { status: "investigating" | "corrected" | "closed"; correctionNote?: string | null }) {
  if (!canManageTeam(context.role)) throw new GovernanceError(403, "forbidden", "Only owners and administrators can update incidents.");
  if (input.status !== "investigating" && !input.correctionNote?.trim()) throw new GovernanceError(422, "correction_required", "Record what was corrected before closing.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const closing = input.status === "closed";
    const [updated] = await tx.update(aiIncidents).set({ status: input.status, correctionNote: input.correctionNote?.trim() || undefined, closedAt: closing ? new Date() : undefined, closedByUserId: closing ? context.internalUserId : undefined, updatedAt: new Date() })
      .where(and(eq(aiIncidents.id, id), eq(aiIncidents.organisationId, context.organisationId), ne(aiIncidents.status, "closed"))).returning();
    if (!updated) throw new GovernanceError(404, "not_found", "The incident could not be found or is already closed.");
    await audit(tx, context, "ai.incident_updated", "ai_incident", id, { status: input.status });
    return updated;
  });
}

// Job consent.

export const consentInput = z.object({
  status: z.enum(["granted", "withdrawn"]),
  uses: z.array(z.enum(aiUses)).max(aiUses.length),
  method: z.enum(["written", "electronic", "verbal_recorded", "terms_of_engagement"]),
  note: z.string().trim().max(1000).nullable().optional(),
}).refine((input) => input.status === "withdrawn" || input.uses.length > 0, { message: "Choose the uses the client agreed to.", path: ["uses"] });

/** Appends a consent record for the job against the firm's current disclosure. Withdrawal is a new record. */
export async function recordAiConsent(context: GovernanceContext, jobId: string, input: z.infer<typeof consentInput>) {
  if (!canMutateOperations(context.role)) throw new GovernanceError(403, "forbidden", "Your role cannot record consent.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId))).limit(1);
    if (!job) throw new GovernanceError(404, "job_not_found", "The job could not be found.");
    const [settings] = await tx.select().from(organisationAiSettings).where(eq(organisationAiSettings.organisationId, context.organisationId)).limit(1);
    if (input.status === "granted") {
      if (!settings?.aiFeaturesEnabled || !settings.disclosureText) throw new GovernanceError(409, "ai_disabled", "Turn on AI features and write the client disclosure first.");
      const outside = input.uses.filter((use) => !settings.permittedUses.includes(use));
      if (outside.length) throw new GovernanceError(422, "use_not_permitted", "Consent can only cover uses the firm has permitted.");
    }
    const [created] = await tx.insert(aiConsentRecords).values({ organisationId: context.organisationId, jobId, status: input.status, uses: input.status === "withdrawn" ? [] : input.uses, disclosureVersion: settings?.disclosureVersion ?? 0, method: input.method, note: input.note ?? null, recordedByUserId: context.internalUserId }).returning();
    await audit(tx, context, `ai.consent_${input.status}`, "job", jobId, { uses: created.uses, disclosureVersion: created.disclosureVersion, method: input.method });
    return created;
  });
}

export async function loadJobAiStatus(context: Pick<GovernanceContext, "organisationId">, jobId: string) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const records = await tx.select().from(aiConsentRecords).where(and(eq(aiConsentRecords.organisationId, context.organisationId), eq(aiConsentRecords.jobId, jobId))).orderBy(desc(aiConsentRecords.createdAt)).limit(20);
    const gates = await Promise.all(aiUses.map((use) => loadAiGate(tx, context.organisationId, jobId, use)));
    return { consents: records.map((row) => ({ id: row.id, status: row.status, uses: row.uses, method: row.method, disclosureVersion: row.disclosureVersion, note: row.note, createdAt: row.createdAt.toISOString() })), gates };
  });
}

// Platform: model register and aggregate evaluation metrics (owner connection).

function adminDb() {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for platform administration.");
  return createDatabase(process.env.DATABASE_ADMIN_URL);
}

export const registerInput = z.object({
  providerKey: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,40}$/),
  modelId: z.string().trim().min(1).max(120),
  modelVersion: z.string().trim().min(1).max(60),
  uses: z.array(z.enum(aiUses)).min(1).max(aiUses.length),
  processingLocation: z.string().trim().min(2).max(200),
  retentionTerms: z.string().trim().min(5).max(1000),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function loadModelRegister() {
  return adminDb().select().from(aiModelRegister).orderBy(desc(aiModelRegister.createdAt));
}

export async function proposeModel(operator: { platformStaffId: string }, input: z.infer<typeof registerInput>) {
  const db = adminDb();
  const [created] = await db.insert(aiModelRegister).values({ ...input, notes: input.notes ?? null }).returning();
  await db.insert(auditEvents).values({ platformStaffId: operator.platformStaffId, action: "ai.model_proposed", resourceType: "ai_model", resourceId: created.id, metadata: { providerKey: input.providerKey, modelId: input.modelId, modelVersion: input.modelVersion, uses: input.uses } });
  return created;
}

/** Approval needs a recorded evaluation (for example the evaluation pack against this model). Suspension takes effect at once. */
export async function setModelStatus(operator: { platformStaffId: string }, id: string, input: { status: "approved" | "suspended" | "retired"; evaluationSummary?: Record<string, unknown> }) {
  const db = adminDb();
  if (input.status === "approved" && !input.evaluationSummary) throw new GovernanceError(422, "evaluation_required", "Record the evaluation results before approving a model.");
  const [updated] = await db.update(aiModelRegister).set(input.status === "approved"
    ? { status: "approved", evaluationSummary: input.evaluationSummary!, evaluatedAt: new Date(), approvedAt: new Date(), approvedByStaffId: operator.platformStaffId, updatedAt: new Date() }
    : { status: input.status, updatedAt: new Date() }).where(eq(aiModelRegister.id, id)).returning();
  if (!updated) throw new GovernanceError(404, "not_found", "The model could not be found.");
  await db.insert(auditEvents).values({ platformStaffId: operator.platformStaffId, action: `ai.model_${input.status}`, resourceType: "ai_model", resourceId: id, metadata: { providerKey: updated.providerKey, modelId: updated.modelId } });
  return updated;
}

const count = (rows: unknown) => (rows as { rows: Record<string, unknown>[] }).rows;

/** Platform-wide totals only. No firm is named, and no record content leaves its tenant. */
export async function loadAssistantMetrics() {
  const db = adminDb();
  const [proposals, rejectedWithNotes, tasks, overrides, reports, incidents, firms, jobsQueue, runs, analyses] = await Promise.all([
    db.execute(sql`select origin_class as origin, review_status as status, count(*)::int as count from field_proposals group by 1, 2 order by 1, 2`),
    db.execute(sql`select count(*)::int as count from field_proposals where review_status = 'rejected' and review_note is not null`),
    db.execute(sql`select kind, status, count(*)::int as count from assistant_tasks group by 1, 2 order by 1, 2`),
    db.execute(sql`select coalesce(rule_id, category) as rule, count(*)::int as count from completion_overrides group by 1 order by 2 desc limit 20`),
    db.execute(sql`select (select count(*)::int from report_versions) as composed, (select count(*)::int from report_approvals) as signed_off`),
    db.execute(sql`select category, severity, status, count(*)::int as count from ai_incidents group by 1, 2, 3 order by 1`),
    db.execute(sql`select count(*) filter (where ai_features_enabled)::int as ai_enabled, count(*)::int as configured from organisation_ai_settings`),
    db.execute(sql`select queue, status, count(*)::int as count from background_jobs group by 1, 2 order by 1, 2`),
    db.execute(sql`select status, count(*)::int as count from enrichment_runs where created_at > now() - interval '7 days' group by 1 order by 1`),
    db.execute(sql`select analyser, status, count(*)::int as count from media_analyses group by 1, 2 order by 1, 2`),
  ]);
  return {
    proposals: count(proposals), rejectedWithNotes: Number(count(rejectedWithNotes)[0]?.count ?? 0), tasks: count(tasks), overrides: count(overrides),
    reports: count(reports)[0] ?? { composed: 0, signed_off: 0 }, incidents: count(incidents), firms: count(firms)[0] ?? { ai_enabled: 0, configured: 0 },
    operations: { jobs: count(jobsQueue), enrichmentRuns7d: count(runs), mediaAnalyses: count(analyses) },
  };
}
