import { and, asc, desc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { builtInTemplates, clausePurposes, conditionRatings, inspectionStatuses, nextActions, serviceLevels, unknownPlaceholders, type WordingClause } from "@surveynt/assistant";
import { auditEvents, createDatabase, wordingClauses, withTenant, type TenantTransaction } from "@surveynt/db";
import { hasProfessionalPermission, canConfirmPropertyIdentity, ukCountries, type OrganisationRole } from "@surveynt/domain";

export type WordingContext = { organisationId: string; internalUserId: string | null; role: OrganisationRole; canRecordSurvey?: boolean; canApproveReports?: boolean };

const elementKeys = new Set(builtInTemplates.flatMap((template) => template.sections.flatMap((section) => section.elements.map((element) => `${section.key}.${element.key}`))));

const clauseFields = z.object({
  clauseKey: z.string().trim().regex(/^[a-z0-9][a-z0-9_.-]{1,80}$/, "Use lower-case letters, numbers, dots, dashes or underscores."),
  purpose: z.enum(clausePurposes),
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(10).max(4000),
  elementKey: z.string().refine((value) => elementKeys.has(value), "Unknown element.").nullable(),
  conditionRatings: z.array(z.enum(conditionRatings)).max(4).default([]),
  nextActions: z.array(z.enum(nextActions)).max(nextActions.length).default([]),
  inspectionStatuses: z.array(z.enum(inspectionStatuses)).max(inspectionStatuses.length).default([]),
  jurisdictions: z.array(z.enum(ukCountries)).max(4).default([]),
  serviceLevels: z.array(z.enum(serviceLevels)).max(serviceLevels.length).default([]),
  source: z.enum(["firm_authored", "licensed_third_party"]).default("firm_authored"),
  licenceReference: z.string().trim().max(300).nullable().default(null),
});

function checkClause(input: { body: string; source: string; licenceReference: string | null }, context: z.RefinementCtx) {
  const unknown = unknownPlaceholders(input.body);
  if (unknown.length) context.addIssue({ code: "custom", path: ["body"], message: `Unknown placeholders: {${unknown.join("}, {")}}. Use {element}, {location}, {next_action} or {rating}.` });
  if (input.source === "licensed_third_party" && !input.licenceReference) context.addIssue({ code: "custom", path: ["licenceReference"], message: "Licensed wording needs the licence reference." });
}

export const clauseInputSchema = clauseFields.superRefine(checkClause);
export const clauseUpdateSchema = clauseFields.omit({ clauseKey: true }).superRefine(checkClause);
export type ClauseInput = z.infer<typeof clauseInputSchema>;
export type ClauseUpdate = z.infer<typeof clauseUpdateSchema>;

export class WordingError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export const canAuthorWording = (role: OrganisationRole, granted = false) => canConfirmPropertyIdentity(role, granted);

export function toClause(row: typeof wordingClauses.$inferSelect): WordingClause {
  return { id: row.id, clauseKey: row.clauseKey, version: row.version, status: row.status as WordingClause["status"], purpose: row.purpose as WordingClause["purpose"], title: row.title, body: row.body, elementKey: row.elementKey, conditionRatings: row.conditionRatings, nextActions: row.nextActions, inspectionStatuses: row.inspectionStatuses, jurisdictions: row.jurisdictions, serviceLevels: row.serviceLevels };
}

/** Approved clauses for report composition, read inside the caller's tenant transaction. */
export async function approvedClauses(tx: TenantTransaction, organisationId: string) {
  return (await tx.select().from(wordingClauses).where(and(eq(wordingClauses.organisationId, organisationId), eq(wordingClauses.status, "approved")))).map(toClause);
}

export async function listWording(context: Pick<WordingContext, "organisationId">) {
  const db = createDatabase();
  const rows = await withTenant(db, context.organisationId, (tx) => tx.select().from(wordingClauses).where(eq(wordingClauses.organisationId, context.organisationId)).orderBy(asc(wordingClauses.clauseKey), desc(wordingClauses.version)));
  return rows.map((row) => ({ ...toClause(row), source: row.source, licenceReference: row.licenceReference, approvedAt: row.approvedAt?.toISOString() ?? null, retiredAt: row.retiredAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
}

async function audit(tx: TenantTransaction, context: WordingContext, action: string, id: string, metadata: Record<string, unknown>) {
  await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action, resourceType: "wording_clause", resourceId: id, metadata });
}

/** Creates a draft: version 1 of a new key, or the next version of an existing key. */
export async function createWordingDraft(context: WordingContext, input: ClauseInput) {
  if (!canAuthorWording(context.role, context.canRecordSurvey)) throw new WordingError(403, "forbidden", "Only surveyors, administrators and owners can write wording.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [{ latest }] = await tx.select({ latest: max(wordingClauses.version) }).from(wordingClauses).where(and(eq(wordingClauses.organisationId, context.organisationId), eq(wordingClauses.clauseKey, input.clauseKey)));
    const [openDraft] = await tx.select({ id: wordingClauses.id }).from(wordingClauses).where(and(eq(wordingClauses.organisationId, context.organisationId), eq(wordingClauses.clauseKey, input.clauseKey), eq(wordingClauses.status, "draft"))).limit(1);
    if (openDraft) throw new WordingError(409, "draft_exists", "This clause already has a draft. Edit it instead.");
    const [previous] = latest ? await tx.select({ id: wordingClauses.id }).from(wordingClauses).where(and(eq(wordingClauses.organisationId, context.organisationId), eq(wordingClauses.clauseKey, input.clauseKey), eq(wordingClauses.version, latest))).limit(1) : [];
    const [created] = await tx.insert(wordingClauses).values({ organisationId: context.organisationId, ...input, version: (latest ?? 0) + 1, supersedesId: previous?.id ?? null, createdByUserId: context.internalUserId }).returning();
    await audit(tx, context, "wording.draft_created", created.id, { clauseKey: created.clauseKey, version: created.version });
    return toClause(created);
  });
}

export async function updateWordingDraft(context: WordingContext, id: string, input: ClauseUpdate) {
  if (!canAuthorWording(context.role, context.canRecordSurvey)) throw new WordingError(403, "forbidden", "Only surveyors, administrators and owners can write wording.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [row] = await tx.select().from(wordingClauses).where(and(eq(wordingClauses.id, id), eq(wordingClauses.organisationId, context.organisationId))).limit(1);
    if (!row) throw new WordingError(404, "clause_not_found", "The clause could not be found.");
    if (row.status !== "draft") throw new WordingError(409, "not_draft", "Approved wording cannot change. Create a new version.");
    const [updated] = await tx.update(wordingClauses).set({ ...input, updatedAt: new Date() }).where(eq(wordingClauses.id, id)).returning();
    await audit(tx, context, "wording.draft_updated", id, { clauseKey: row.clauseKey, version: row.version });
    return toClause(updated);
  });
}

/** Approves a draft and retires the previously approved version of the same clause, in one transaction. */
export async function approveWording(context: WordingContext, id: string) {
  if (!hasProfessionalPermission(context.role, "approve_reports", context.canApproveReports)) throw new WordingError(403, "forbidden", "Only owners and administrators can approve wording.");
  if (!context.internalUserId) throw new WordingError(403, "forbidden", "Approval needs a named user.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [row] = await tx.select().from(wordingClauses).where(and(eq(wordingClauses.id, id), eq(wordingClauses.organisationId, context.organisationId))).limit(1);
    if (!row) throw new WordingError(404, "clause_not_found", "The clause could not be found.");
    if (row.status !== "draft") throw new WordingError(409, "not_draft", "Only drafts can be approved.");
    if (unknownPlaceholders(row.body).length) throw new WordingError(422, "invalid_placeholders", "The clause uses unknown placeholders.");
    const now = new Date();
    await tx.update(wordingClauses).set({ status: "retired", retiredAt: now, retiredByUserId: context.internalUserId, updatedAt: now }).where(and(eq(wordingClauses.organisationId, context.organisationId), eq(wordingClauses.clauseKey, row.clauseKey), eq(wordingClauses.status, "approved")));
    const [approved] = await tx.update(wordingClauses).set({ status: "approved", approvedAt: now, approvedByUserId: context.internalUserId, updatedAt: now }).where(eq(wordingClauses.id, id)).returning();
    await audit(tx, context, "wording.approved", id, { clauseKey: row.clauseKey, version: row.version });
    return toClause(approved);
  });
}

/** Deletes a draft (authors), or retires an approved version (owners and administrators). */
export async function retireWording(context: WordingContext, id: string) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [row] = await tx.select().from(wordingClauses).where(and(eq(wordingClauses.id, id), eq(wordingClauses.organisationId, context.organisationId))).limit(1);
    if (!row) throw new WordingError(404, "clause_not_found", "The clause could not be found.");
    if (row.status === "draft") {
      if (!canAuthorWording(context.role, context.canRecordSurvey)) throw new WordingError(403, "forbidden", "Only surveyors, administrators and owners can delete drafts.");
      await tx.delete(wordingClauses).where(eq(wordingClauses.id, id));
      await audit(tx, context, "wording.draft_deleted", id, { clauseKey: row.clauseKey, version: row.version });
      return null;
    }
    if (!hasProfessionalPermission(context.role, "approve_reports", context.canApproveReports)) throw new WordingError(403, "forbidden", "Only owners and administrators can retire wording.");
    if (row.status !== "approved") throw new WordingError(409, "already_retired", "This version is already retired.");
    const now = new Date();
    const [retired] = await tx.update(wordingClauses).set({ status: "retired", retiredAt: now, retiredByUserId: context.internalUserId, updatedAt: now }).where(eq(wordingClauses.id, id)).returning();
    await audit(tx, context, "wording.retired", id, { clauseKey: row.clauseKey, version: row.version });
    return toClause(retired);
  });
}
