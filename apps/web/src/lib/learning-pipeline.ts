import { createHmac } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { applyRarityCheck, currentGrant, evaluateEligibility, extractCandidates, quasiIdentifierKey, sanitiseCandidate, type KnownIdentifiers } from "@surveynt/learning";
import {
  clientContacts, clients, createDatabase, evidenceLinks, jobs, learningAuditLog, learningCandidates, learningContributionGrants, learningContributors, learningReviews,
  learningReleaseItems, learningSanitisationRuns, learningWithdrawalRequests, organisationMemberships, sharedCases, organisations, properties, reportApprovals, reportVersions, surveyFileRemovals, surveys, users, withTenant, type Database,
} from "@surveynt/db";
import { loadProgramme } from "./learning";
import { readSurveyPack } from "./surveys";

// The learning service. It reads a firm's signed-off surveys through the
// tenant connection (row-level security applies) and writes candidate copies
// through a separate role that can reach restricted staging but no tenant table.

export function learningDb(): Database | null {
  return process.env.DATABASE_LEARNING_URL ? createDatabase(process.env.DATABASE_LEARNING_URL) : null;
}

/** Keyed hash for restricted lineage (property grouping). A plain hash of a UPRN could be reversed by enumeration. */
function lineageHash(value: string) {
  const secret = process.env.LEARNING_LINEAGE_SECRET;
  if (!secret || secret.length < 32) throw new Error("LEARNING_LINEAGE_SECRET (at least 32 characters) is required for shared learning.");
  return createHmac("sha256", secret).update(value).digest("hex");
}

async function contributorKeyFor(db: Database, organisationId: string) {
  await db.insert(learningContributors).values({ organisationId }).onConflictDoNothing();
  const [row] = await db.select({ key: learningContributors.contributorKey }).from(learningContributors).where(eq(learningContributors.organisationId, organisationId)).limit(1);
  return row.key;
}

export type ExtractionOutcome = { status: "inactive" | "not_configured" | "done"; reasons?: string[]; surveys: number; created: number; quarantined: number; skipped: { surveyId: string; reasons: string[] }[] };

/**
 * Pipeline steps 1-3 for one firm: eligibility, minimal extraction and
 * sanitisation into restricted staging. Each signed-off report version is
 * processed once; the restricted audit log is the ledger.
 */
export async function extractFirmCandidates(organisationId: string, limit = 10): Promise<ExtractionOutcome> {
  const app = createDatabase();
  const programme = await loadProgramme(app);
  if (!programme.status.active) return { status: "inactive", reasons: programme.status.reasons.map((reason) => reason.code), surveys: 0, created: 0, quarantined: 0, skipped: [] };
  const restricted = learningDb();
  if (!restricted || !process.env.LEARNING_LINEAGE_SECRET) return { status: "not_configured", reasons: ["DATABASE_LEARNING_URL and LEARNING_LINEAGE_SECRET are required."], surveys: 0, created: 0, quarantined: 0, skipped: [] };
  const criteria = programme.status.criteria!;

  const processed = new Set((await restricted.select({ metadata: learningAuditLog.metadata }).from(learningAuditLog)
    .where(and(eq(learningAuditLog.organisationId, organisationId), eq(learningAuditLog.action, "extraction.survey_processed")))).map((row) => String(row.metadata.reportVersionId)));
  const outcome: ExtractionOutcome = { status: "done", surveys: 0, created: 0, quarantined: 0, skipped: [] };

  const work = await withTenant(app, organisationId, async (tx) => {
    const [grants, withdrawals, signedOff] = await Promise.all([
      tx.select().from(learningContributionGrants).where(eq(learningContributionGrants.organisationId, organisationId)),
      tx.select({ scope: learningWithdrawalRequests.scope, jobId: learningWithdrawalRequests.jobId, createdAt: learningWithdrawalRequests.createdAt }).from(learningWithdrawalRequests).where(eq(learningWithdrawalRequests.organisationId, organisationId)),
      tx.select({ surveyId: surveys.id, jobId: surveys.jobId, propertyId: surveys.propertyId, status: surveys.status, jurisdiction: surveys.jurisdiction, reportVersionId: reportVersions.id, signedOffAt: reportApprovals.createdAt })
        .from(surveys).innerJoin(reportVersions, eq(reportVersions.surveyId, surveys.id)).innerJoin(reportApprovals, eq(reportApprovals.reportVersionId, reportVersions.id))
        .where(and(eq(surveys.organisationId, organisationId), eq(surveys.status, "approved"),
          // A file under retention removal is never copied, even before its content is cleaned.
          sql`not exists (select 1 from ${surveyFileRemovals} r where r.organisation_id = ${surveys.organisationId} and r.job_id = ${surveys.jobId} and r.status <> 'cancelled')`))
        .orderBy(desc(reportApprovals.createdAt)).limit(200),
    ]);
    const due = signedOff.filter((row) => !processed.has(row.reportVersionId)).slice(0, limit);
    const grant = currentGrant(grants, "structured_cases") as typeof grants[number] | null;
    const items = [];
    for (const row of due) {
      const eligibility = evaluateEligibility({ programme: programme.status, scope: "structured_cases", grants, withdrawals, jobId: row.jobId, survey: { status: row.status, signedOff: true, jurisdiction: row.jurisdiction } });
      if (!eligibility.eligible || !grant) { items.push({ row, eligibility, grant, pack: null, known: null, property: null, photos: {} }); continue; }
      const pack = await readSurveyPack(tx, { organisationId }, row.surveyId);
      const [[job], [organisation], [property], members, evidence] = await Promise.all([
        tx.select({ reference: jobs.reference, clientId: jobs.clientId }).from(jobs).where(eq(jobs.id, row.jobId)).limit(1),
        tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, organisationId)).limit(1),
        tx.select({ line1: properties.line1, line2: properties.line2, city: properties.city, postcode: properties.postcode, uprn: properties.uprn, uprnConfirmedAt: properties.uprnConfirmedAt }).from(properties).where(eq(properties.id, row.propertyId)).limit(1),
        tx.select({ firstName: users.firstName, lastName: users.lastName, email: users.email }).from(organisationMemberships).innerJoin(users, eq(users.id, organisationMemberships.userId)).where(eq(organisationMemberships.organisationId, organisationId)),
        tx.select({ targetType: evidenceLinks.targetType, targetId: evidenceLinks.targetId, evidenceType: evidenceLinks.evidenceType }).from(evidenceLinks).where(and(eq(evidenceLinks.surveyId, row.surveyId), sql`${evidenceLinks.removedAt} is null`)),
      ]);
      const [client] = job ? await tx.select({ name: clients.displayName, email: clients.email, phone: clients.phone }).from(clients).where(eq(clients.id, job.clientId)).limit(1) : [];
      const contacts = job ? await tx.select({ name: clientContacts.name, email: clientContacts.email, phone: clientContacts.phone }).from(clientContacts).where(eq(clientContacts.clientId, job.clientId)) : [];
      const known: KnownIdentifiers = {
        names: [organisation?.name, client?.name, ...contacts.map((item) => item.name), ...members.map((item) => [item.firstName, item.lastName].filter(Boolean).join(" "))].filter((value): value is string => Boolean(value?.trim())),
        addressParts: [property?.line1, property?.line2, property?.city, property?.postcode].filter((value): value is string => Boolean(value?.trim())),
        references: [job?.reference, property?.uprn, client?.email, client?.phone, ...contacts.flatMap((item) => [item.email, item.phone]), ...members.map((item) => item.email)].filter((value): value is string => Boolean(value?.trim())),
      };
      const photos: Record<string, number> = {};
      for (const link of evidence) if (link.targetType === "element" && link.evidenceType === "media") photos[link.targetId] = (photos[link.targetId] ?? 0) + 1;
      items.push({ row, eligibility, grant, pack, known, property, photos });
    }
    return items;
  });

  const contributorKey = await contributorKeyFor(restricted, organisationId);
  for (const item of work) {
    outcome.surveys += 1;
    const { row } = item;
    if (!item.eligibility.eligible || !item.pack || !item.known || !item.grant) {
      outcome.skipped.push({ surveyId: row.surveyId, reasons: item.eligibility.reasons.map((reason) => reason.code) });
      // Ineligible surveys are not marked processed: a later grant may make them eligible.
      continue;
    }
    const labels = Object.fromEntries(item.pack.template.sections.flatMap((section) => section.elements.map((element) => [`${section.key}.${element.key}`, element.label])));
    const grant = item.grant;
    const candidates = extractCandidates({ survey: item.pack.survey, values: item.pack.values, elements: item.pack.elements, observations: item.pack.observations, photosByElement: item.photos, elementLabels: labels });
    const propertyIdentity = item.property?.uprn && item.property.uprnConfirmedAt ? `uprn:${item.property.uprn}` : `property:${organisationId}:${row.propertyId}`;
    const sanitised = candidates.map((candidate) => ({ candidate, result: sanitiseCandidate(candidate.content, item.known!) }));
    const keys = [...new Set(sanitised.flatMap(({ result }) => [result.quasiKey, quasiIdentifierKey({ ...result.case, property: { ...result.case.property, builtForm: null, storeys: null } })]))];
    const counts = new Map<string, number>();
    if (keys.length) {
      const rows = await restricted.select({ key: learningSanitisationRuns.quasiKey, count: sql<number>`count(*)::int` }).from(learningSanitisationRuns).where(inArray(learningSanitisationRuns.quasiKey, keys)).groupBy(learningSanitisationRuns.quasiKey);
      for (const entry of rows) counts.set(entry.key, Number(entry.count));
    }
    await restricted.transaction(async (ltx) => {
      for (const { candidate, result } of sanitised) {
        const checked = applyRarityCheck(result, (key) => counts.get(key) ?? 0, criteria.rareCombinationReviewBelow);
        const [created] = await ltx.insert(learningCandidates).values({
          organisationId, contributorKey, jobId: row.jobId, surveyId: row.surveyId, elementId: candidate.elementId, elementRef: candidate.elementRef, scope: "structured_cases",
          grantId: grant.id, policyVersion: grant.policyVersion, sourceFingerprint: `${row.reportVersionId}:${candidate.elementId}`,
          dedupKey: lineageHash(`${propertyIdentity}|${candidate.elementRef}`), groupKey: lineageHash(propertyIdentity), content: candidate.content as unknown as Record<string, unknown>,
          status: checked.quarantined ? "quarantined" : "awaiting_privacy_review", statusReason: checked.quarantined ? "Rare combination after generalisation; needs manual privacy review." : null,
        }).onConflictDoNothing().returning({ id: learningCandidates.id });
        if (!created) continue;
        await ltx.insert(learningSanitisationRuns).values({ candidateId: created.id, transformer: checked.transformer, output: checked.case as unknown as Record<string, unknown>, findings: checked.findings, residualTerms: checked.residualTerms, flags: checked.flags, quasiKey: checked.quasiKey, outcome: checked.quarantined ? "quarantined" : "passed" });
        counts.set(checked.quasiKey, (counts.get(checked.quasiKey) ?? 0) + 1);
        outcome.created += 1;
        if (checked.quarantined) outcome.quarantined += 1;
      }
      await ltx.insert(learningAuditLog).values({ actor: "learning_service", action: "extraction.survey_processed", organisationId, metadata: { reportVersionId: row.reportVersionId, surveyId: row.surveyId, candidates: sanitised.length } });
    });
  }
  return outcome;
}

export type WithdrawalOutcome = { status: "completed" | "pending"; candidatesWithdrawn: number; sharedCasesRemoved: number; message: string };

/**
 * Propagates a withdrawal: candidate copies are cleared, sanitisation and review
 * records erased, released cases removed from retrieval, and future training
 * eligibility ends. Only a restricted audit entry and the lineage stub remain.
 */
export async function processWithdrawal(organisationId: string, requestId: string): Promise<WithdrawalOutcome> {
  const app = createDatabase();
  const [request] = await withTenant(app, organisationId, (tx) => tx.select().from(learningWithdrawalRequests).where(and(eq(learningWithdrawalRequests.id, requestId), eq(learningWithdrawalRequests.organisationId, organisationId))).limit(1));
  if (!request) throw new Error("Withdrawal request not found.");
  if (request.status === "completed") return { status: "completed", candidatesWithdrawn: Number(request.outcome.candidatesWithdrawn ?? 0), sharedCasesRemoved: Number(request.outcome.sharedCasesRemoved ?? 0), message: "Already processed." };
  const restricted = learningDb();
  if (!restricted) return { status: "pending", candidatesWithdrawn: 0, sharedCasesRemoved: 0, message: "Recorded. The learning service is not configured here, so it will be processed when it is; nothing is copied while it is unconfigured." };
  const affectsCases = request.scope === null || request.scope === "structured_cases";
  const result = { candidatesWithdrawn: 0, sharedCasesRemoved: 0 };
  if (affectsCases) {
    await restricted.transaction(async (ltx) => {
      await ltx.execute(sql`select set_config('app.erasure', 'on', true)`);
      const conditions = [eq(learningCandidates.organisationId, organisationId), ne(learningCandidates.status, "withdrawn")];
      if (request.jobId) conditions.push(eq(learningCandidates.jobId, request.jobId));
      const ids = (await ltx.select({ id: learningCandidates.id }).from(learningCandidates).where(and(...conditions))).map((row) => row.id);
      result.sharedCasesRemoved = await eraseCandidates(ltx, ids, "Withdrawn by the contributing firm.");
      result.candidatesWithdrawn = ids.length;
      await ltx.insert(learningAuditLog).values({ actor: "learning_service", action: "withdrawal.processed", organisationId, metadata: { requestId, scope: request.scope, jobId: request.jobId, candidates: ids.length, sharedCases: result.sharedCasesRemoved } });
    });
  }
  const message = affectsCases
    ? `${result.candidatesWithdrawn} staged case${result.candidatesWithdrawn === 1 ? "" : "s"} withdrawn and ${result.sharedCasesRemoved} released case${result.sharedCasesRemoved === 1 ? "" : "s"} removed from shared retrieval.`
    : "No copied material depends on this scope alone; its eligibility ended with the request.";
  await withTenant(app, organisationId, (tx) => tx.update(learningWithdrawalRequests).set({ status: "completed", outcome: { ...result, message }, completedAt: new Date() }).where(eq(learningWithdrawalRequests.id, requestId)));
  return { status: "completed", ...result, message };
}

type ErasureTx = Pick<Database, "select" | "update" | "delete" | "execute">;

/** Clears candidate copies, erases their sanitisation and review records and removes released copies. Call with app.erasure on. */
async function eraseCandidates(tx: ErasureTx, ids: string[], reason: string) {
  if (!ids.length) return 0;
  const removed = await removeSharedCases(tx, ids, reason);
  await tx.delete(learningSanitisationRuns).where(inArray(learningSanitisationRuns.candidateId, ids));
  await tx.delete(learningReviews).where(inArray(learningReviews.candidateId, ids));
  await tx.update(learningCandidates).set({ status: "withdrawn", content: {}, statusReason: reason, updatedAt: new Date() }).where(inArray(learningCandidates.id, ids));
  return removed;
}

/**
 * Retention removal of a survey file ends its learning use, like a job
 * withdrawal: staged copies are cleared and released copies leave retrieval.
 * Runs for removals that have reached storage dispatch or later.
 */
export async function propagateFileRemovals(admin: Database, restricted: Database | null = learningDb()) {
  const removals = await admin.select({ organisationId: surveyFileRemovals.organisationId, jobId: surveyFileRemovals.jobId }).from(surveyFileRemovals)
    .where(inArray(surveyFileRemovals.status, ["dispatched", "verification_required", "completed"]));
  if (!restricted || !removals.length) return { files: 0, candidatesErased: 0, sharedCasesRemoved: 0 };
  const result = { files: 0, candidatesErased: 0, sharedCasesRemoved: 0 };
  for (const removal of removals) {
    await restricted.transaction(async (ltx) => {
      const ids = (await ltx.select({ id: learningCandidates.id }).from(learningCandidates)
        .where(and(eq(learningCandidates.organisationId, removal.organisationId), eq(learningCandidates.jobId, removal.jobId), ne(learningCandidates.status, "withdrawn")))).map((row) => row.id);
      if (!ids.length) return;
      await ltx.execute(sql`select set_config('app.erasure', 'on', true)`);
      const shared = await eraseCandidates(ltx, ids, "Survey file removed under the practice retention policy.");
      await ltx.insert(learningAuditLog).values({ actor: "learning_service", action: "retention.file_removed", organisationId: removal.organisationId, metadata: { jobId: removal.jobId, candidates: ids.length, sharedCases: shared } });
      result.files += 1; result.candidatesErased += ids.length; result.sharedCasesRemoved += shared;
    });
  }
  return result;
}

/** Removes released copies of these candidates from every release and marks the release items withdrawn. */
async function removeSharedCases(tx: ErasureTx, candidateIds: string[], reason = "Withdrawn by the contributing firm.") {
  const items = await tx.select({ sharedCaseId: learningReleaseItems.sharedCaseId, releaseId: learningReleaseItems.releaseId }).from(learningReleaseItems)
    .where(and(inArray(learningReleaseItems.candidateId, candidateIds), eq(learningReleaseItems.status, "included")));
  if (!items.length) return 0;
  const shared = items.map((item) => item.sharedCaseId);
  const deleted = await tx.delete(sharedCases).where(inArray(sharedCases.id, shared)).returning({ id: sharedCases.id });
  await tx.update(learningReleaseItems).set({ status: "withdrawn", statusReason: reason }).where(inArray(learningReleaseItems.sharedCaseId, shared));
  for (const releaseId of new Set(items.map((item) => item.releaseId))) {
    await tx.execute(sql`update learning_shared.releases set case_count = (select count(*) from learning_shared.cases c where c.release_id = ${releaseId}) where id = ${releaseId}`);
  }
  return deleted.length;
}

/** Daily sweep: withdrawals are always processed; extraction only while the programme is active. */
export async function runLearningSweep(limitPerFirm = 10) {
  if (!process.env.DATABASE_ADMIN_URL) return { withdrawals: 0, firms: 0, created: 0 };
  const admin = createDatabase(process.env.DATABASE_ADMIN_URL);
  const pending = await admin.select({ id: learningWithdrawalRequests.id, organisationId: learningWithdrawalRequests.organisationId }).from(learningWithdrawalRequests).where(eq(learningWithdrawalRequests.status, "requested")).limit(100);
  let withdrawals = 0;
  for (const request of pending) if ((await processWithdrawal(request.organisationId, request.id)).status === "completed") withdrawals += 1;
  const removedFiles = await propagateFileRemovals(admin);
  const programme = await loadProgramme(admin);
  if (!programme.status.active) return { withdrawals, removedFiles, firms: 0, created: 0, inactive: programme.status.reasons.map((reason) => reason.code) };
  const firms = await admin.selectDistinct({ organisationId: learningContributionGrants.organisationId }).from(learningContributionGrants).where(eq(learningContributionGrants.status, "granted"));
  let created = 0;
  for (const firm of firms) created += (await extractFirmCandidates(firm.organisationId, limitPerFirm)).created;
  return { withdrawals, removedFiles, firms: firms.length, created };
}

/**
 * Takes a released case out of shared retrieval in every release and moves its
 * candidate on: back to a review queue for correction, or rejected.
 */
export async function retractCandidateCases(db: Database, input: { sharedCaseId: string; reason: string; nextStatus: "quarantined" | "awaiting_technical_review" | "rejected"; actorStaffId: string | null; actor: string }) {
  return db.transaction(async (tx) => {
    const [item] = await tx.select({ candidateId: learningReleaseItems.candidateId }).from(learningReleaseItems).where(eq(learningReleaseItems.sharedCaseId, input.sharedCaseId)).limit(1);
    if (!item) return null;
    const items = await tx.select({ sharedCaseId: learningReleaseItems.sharedCaseId, releaseId: learningReleaseItems.releaseId }).from(learningReleaseItems)
      .where(and(eq(learningReleaseItems.candidateId, item.candidateId), eq(learningReleaseItems.status, "included")));
    const shared = items.map((entry) => entry.sharedCaseId);
    const removed = shared.length ? await tx.delete(sharedCases).where(inArray(sharedCases.id, shared)).returning({ id: sharedCases.id }) : [];
    if (shared.length) await tx.update(learningReleaseItems).set({ status: "retracted", statusReason: input.reason }).where(inArray(learningReleaseItems.sharedCaseId, shared));
    for (const releaseId of new Set(items.map((entry) => entry.releaseId))) {
      await tx.execute(sql`update learning_shared.releases set case_count = (select count(*) from learning_shared.cases c where c.release_id = ${releaseId}) where id = ${releaseId}`);
    }
    const [candidate] = await tx.update(learningCandidates).set({ status: input.nextStatus, statusReason: input.reason, updatedAt: new Date() })
      .where(and(eq(learningCandidates.id, item.candidateId), ne(learningCandidates.status, "withdrawn"))).returning({ id: learningCandidates.id, status: learningCandidates.status });
    await tx.insert(learningAuditLog).values({ actorStaffId: input.actorStaffId, actor: input.actor, action: "case.retracted", candidateId: item.candidateId, metadata: { reason: input.reason, nextStatus: input.nextStatus, sharedCases: removed.length } });
    return { candidateId: item.candidateId, status: candidate?.status ?? "withdrawn", sharedCasesRemoved: removed.length };
  });
}
