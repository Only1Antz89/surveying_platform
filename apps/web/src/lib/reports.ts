import { hasProfessionalPermission } from "@surveynt/domain";
import { currentProfessionalPermission } from "./professional-membership";
import { and, desc, eq, inArray, max } from "drizzle-orm";
import { canonicalJson, composeReport, composerInputFingerprint, COMPOSER, REPORT_SIGN_OFF_STATEMENT, type ComposedReport, type ComposerInput, type FieldValue, type InspectionStatus, type ServiceLevel } from "@surveynt/assistant";
import { auditEvents, completionOverrides, createDatabase, jobs, reportApprovals, reportVersions, surveyFileRemovals, surveys, withTenant, type TenantTransaction } from "@surveynt/db";
import { completionReportFromPack } from "./completion-input";
import { readSurveyPack, type SurveyContext, type SurveyPack } from "./surveys";
import { approvedClauses } from "./wording";

export const SIGN_OFF_STATEMENT = REPORT_SIGN_OFF_STATEMENT;

export class ReportError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function composerInput(pack: SurveyPack, clauses: Awaited<ReturnType<typeof approvedClauses>>): ComposerInput {
  return {
    template: pack.template, serviceLevel: pack.survey.serviceLevel as ServiceLevel, jurisdiction: pack.survey.jurisdiction ?? "ENG",
    job: { reference: pack.job.reference }, property: { line1: pack.property.line1, city: pack.property.city, postcode: pack.property.postcode },
    values: pack.values.map((row) => ({ id: row.id, fieldPath: row.fieldPath, value: row.value as unknown as FieldValue })),
    elements: pack.elements.map((row) => ({ id: row.id, sectionKey: row.sectionKey, elementKey: row.elementKey, locationLabel: row.locationLabel ?? "", inspectionStatus: row.inspectionStatus as InspectionStatus | null, limitationReason: row.limitationReason })),
    observations: pack.observations.map((row) => ({ id: row.id, elementId: row.elementId, kind: row.kind, text: row.text, locationLabel: row.locationLabel, structured: row.structured as Record<string, unknown>, version: row.version })),
    evidence: pack.evidence.map((row) => ({ targetType: row.targetType, targetId: row.targetId, evidenceType: row.evidenceType, evidenceId: row.evidenceId })),
    media: pack.media.map((row) => ({ id: row.id, kind: row.kind })),
    clauses,
  };
}

/** The survey's current composer input and fingerprint, read inside the caller's tenant transaction. */
export async function currentReportInput(tx: TenantTransaction, context: Pick<SurveyContext, "organisationId">, surveyId: string) {
  const pack = await readSurveyPack(tx, context, surveyId);
  if (!pack) return null;
  const input = composerInput(pack, await approvedClauses(tx, context.organisationId));
  return { pack, input, fingerprint: await composerInputFingerprint(input) };
}

/** Composes a new, immutable draft version from approved material only. */
export async function composeSurveyReport(context: SurveyContext, surveyId: string) {
  if (!hasProfessionalPermission(context.role, "record_survey", context.canRecordSurvey)) throw new ReportError(403, "professional_recording_required", "Professional survey recording permission is required.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    if (!await currentProfessionalPermission(tx, context, "record_survey")) throw new ReportError(403, "professional_recording_required", "Your professional recording permission has changed.");
    const current = await currentReportInput(tx, context, surveyId);
    if (!current) throw new ReportError(404, "survey_not_found", "The survey could not be found.");
    // Serialize composition with the removal claim before reading its state.
    await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, current.pack.survey.jobId), eq(jobs.organisationId, context.organisationId))).for("update");
    const [removal] = await tx.select({ id: surveyFileRemovals.id }).from(surveyFileRemovals).where(and(eq(surveyFileRemovals.jobId, current.pack.survey.jobId), eq(surveyFileRemovals.organisationId, context.organisationId), inArray(surveyFileRemovals.status, ["dispatched", "verification_required", "completed"]))).limit(1);
    if (removal) throw new ReportError(409, "originals_under_removal", "This survey file is under retention removal. Create a new instruction for further reporting.");
    const { report, trace } = composeReport(current.input);
    const completion = completionReportFromPack(current.pack);
    const [{ latest }] = await tx.select({ latest: max(reportVersions.versionNumber) }).from(reportVersions).where(and(eq(reportVersions.surveyId, surveyId), eq(reportVersions.organisationId, context.organisationId)));
    const [survey] = await tx.select({ templateFingerprint: surveys.templateFingerprint }).from(surveys).where(eq(surveys.id, surveyId)).limit(1);
    const content = report as unknown as Record<string, unknown>;
    const [created] = await tx.insert(reportVersions).values({
      organisationId: context.organisationId, surveyId, jobId: current.pack.survey.jobId, versionNumber: (latest ?? 0) + 1, composer: COMPOSER,
      templateKey: current.pack.survey.templateKey, templateVersion: current.pack.survey.templateVersion, templateFingerprint: survey.templateFingerprint, ruleSetVersion: completion?.ruleSetVersion ?? null,
      inputFingerprint: current.fingerprint, content, trace: trace as unknown as Record<string, unknown>, contentSha256: await sha256(canonicalJson(content)), createdByUserId: context.internalUserId,
    }).returning();
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "report.version_composed", resourceType: "report_version", resourceId: created.id, metadata: { surveyId, versionNumber: created.versionNumber, clauses: trace.clauses.length, observations: trace.observations.length } });
    return { id: created.id, versionNumber: created.versionNumber, content: report, omissions: report.omissions };
  });
}

export async function loadSurveyReports(context: Pick<SurveyContext, "organisationId">, surveyId: string) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const current = await currentReportInput(tx, context, surveyId);
    if (!current) return null;
    const versions = await tx.select().from(reportVersions).where(and(eq(reportVersions.surveyId, surveyId), eq(reportVersions.organisationId, context.organisationId))).orderBy(desc(reportVersions.versionNumber)).limit(50);
    const approvals = versions.length ? await tx.select().from(reportApprovals).where(and(eq(reportApprovals.organisationId, context.organisationId), inArray(reportApprovals.reportVersionId, versions.map((row) => row.id)))) : [];
    const approvalFor = new Map(approvals.map((row) => [row.reportVersionId, row]));
    return {
      surveyStatus: current.pack.survey.status,
      currentFingerprint: current.fingerprint,
      versions: versions.map((row) => ({
        id: row.id, versionNumber: row.versionNumber, createdAt: row.createdAt.toISOString(), composer: row.composer, contentRemoved: row.content.retentionRemoved === true, current: row.content.retentionRemoved !== true && row.inputFingerprint === current.fingerprint,
        approval: approvalFor.get(row.id) ? { approvedAt: approvalFor.get(row.id)!.createdAt.toISOString(), approverRole: approvalFor.get(row.id)!.approverRole, note: approvalFor.get(row.id)!.note } : null,
      })),
      latest: versions[0] && versions[0].content.retentionRemoved !== true ? { id: versions[0].id, versionNumber: versions[0].versionNumber, content: versions[0].content as unknown as ComposedReport, trace: versions[0].trace } : null,
    };
  });
}

/**
 * Sign-off by a surveyor role. The version must be the latest, its inputs
 * unchanged since it was composed, and every failing completion hard gate
 * resolved or covered by a recorded override. Capture then closes.
 */
export async function approveReportVersion(context: SurveyContext, surveyId: string, versionId: string, input: { confirm: boolean; note?: string | null }) {
  if (!hasProfessionalPermission(context.role, "approve_reports", context.canApproveReports)) throw new ReportError(403, "forbidden", "Explicit professional report approval permission is required.");
  if (!input.confirm) throw new ReportError(400, "confirmation_required", "Confirm that you have reviewed the full report.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    if (!await currentProfessionalPermission(tx, context, "approve_reports")) throw new ReportError(403, "professional_approval_required", "Your professional report approval permission has changed.");
    const current = await currentReportInput(tx, context, surveyId);
    if (!current) throw new ReportError(404, "survey_not_found", "The survey could not be found.");
    if (current.pack.template.key.startsWith("surveynt-home-survey") && current.pack.template.reviewStatus !== "surveyor_reviewed") throw new ReportError(409, "template_review_required", "This firm Home Survey template is a draft. Complete professional template review and any required licence verification before approving or issuing reports.");
    const [latest] = await tx.select().from(reportVersions).where(and(eq(reportVersions.surveyId, surveyId), eq(reportVersions.organisationId, context.organisationId))).orderBy(desc(reportVersions.versionNumber)).limit(1);
    if (!latest || latest.id !== versionId) throw new ReportError(409, "not_latest", "Only the latest report version can be signed off.");
    if (latest.content.retentionRemoved === true) throw new ReportError(410, "report_content_removed", "Report content was removed after retention review.");
    if (latest.inputFingerprint !== current.fingerprint) throw new ReportError(409, "out_of_date", "The survey or approved wording changed after this version was composed. Compose a new version and review it.");
    const [existing] = await tx.select({ id: reportApprovals.id }).from(reportApprovals).where(eq(reportApprovals.reportVersionId, versionId)).limit(1);
    if (existing) throw new ReportError(409, "already_approved", "This version is already signed off.");
    const completion = completionReportFromPack(current.pack);
    if (!completion) throw new ReportError(409, "no_rule_set", "No completion rule set is available for this survey's template version.");
    const overridden = new Set((await tx.select({ itemId: completionOverrides.itemId }).from(completionOverrides).where(and(eq(completionOverrides.surveyId, surveyId), eq(completionOverrides.organisationId, context.organisationId)))).map((row) => row.itemId));
    const blocking = completion.items.filter((item) => item.status === "fail" && item.severity === "hard_gate" && !overridden.has(item.id));
    if (blocking.length) throw new ReportError(422, "completion_checks_failed", "Resolve the failing completion checks, or record reasons when moving the job to internal review, before signing off.", blocking.map((item) => ({ id: item.id, title: item.title })));
    const [approval] = await tx.insert(reportApprovals).values({
      organisationId: context.organisationId, reportVersionId: versionId, approvedByUserId: context.internalUserId, approverRole: context.role, statement: SIGN_OFF_STATEMENT, note: input.note?.trim() || null,
      contentSha256: latest.contentSha256, completion: { ruleSetVersion: completion.ruleSetVersion, hardGateFailures: completion.hardGateFailures, overriddenItems: completion.items.filter((item) => overridden.has(item.id) && item.status === "fail").map((item) => item.id) },
    }).returning();
    await tx.update(surveys).set({ status: "approved", version: current.pack.survey.version + 1, updatedAt: new Date() }).where(and(eq(surveys.id, surveyId), eq(surveys.organisationId, context.organisationId)));
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "report.signed_off", resourceType: "report_version", resourceId: versionId, metadata: { surveyId, versionNumber: latest.versionNumber, contentSha256: latest.contentSha256 } });
    return { approvalId: approval.id, versionNumber: latest.versionNumber };
  });
}

/** Reopens an approved survey for changes; a new version must then be composed and signed off. */
export async function reopenSurvey(context: SurveyContext, surveyId: string, reason: string) {
  if (!hasProfessionalPermission(context.role, "approve_reports", context.canApproveReports)) throw new ReportError(403, "forbidden", "Only surveyors, administrators and owners can reopen a survey.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    if (!await currentProfessionalPermission(tx, context, "approve_reports")) throw new ReportError(403, "professional_approval_required", "Your professional approval permission has changed.");
    const [survey] = await tx.select().from(surveys).where(and(eq(surveys.id, surveyId), eq(surveys.organisationId, context.organisationId))).limit(1);
    if (!survey) throw new ReportError(404, "survey_not_found", "The survey could not be found.");
    if (survey.status !== "approved") throw new ReportError(409, "not_approved", "Only an approved survey can be reopened.");
    const [job] = await tx.select({ stage: jobs.stage }).from(jobs).where(and(eq(jobs.id, survey.jobId), eq(jobs.organisationId, context.organisationId))).limit(1);
    if (job && ["issued", "paid", "archived"].includes(job.stage)) throw new ReportError(409, "already_issued", "The report has been issued. Record corrections as a new instruction.");
    await tx.update(surveys).set({ status: "in_progress", version: survey.version + 1, updatedAt: new Date() }).where(eq(surveys.id, surveyId));
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "survey.reopened", resourceType: "survey", resourceId: surveyId, metadata: { reason } });
    return { status: "in_progress" as const };
  });
}

/** For the issue gate: whether the newest signed-off version still matches the survey. */
export async function approvedReportIsCurrent(tx: TenantTransaction, context: Pick<SurveyContext, "organisationId">, surveyId: string) {
  const [latestApproved] = await tx.select({ id: reportVersions.id, fingerprint: reportVersions.inputFingerprint, versionNumber: reportVersions.versionNumber, content: reportVersions.content }).from(reportVersions)
    .innerJoin(reportApprovals, eq(reportApprovals.reportVersionId, reportVersions.id))
    .where(and(eq(reportVersions.surveyId, surveyId), eq(reportVersions.organisationId, context.organisationId))).orderBy(desc(reportVersions.versionNumber)).limit(1);
  if (!latestApproved) return { approved: false as const, current: false };
  if (latestApproved.content.retentionRemoved === true) return { approved: true as const, current: false, versionNumber: latestApproved.versionNumber, contentRemoved: true };
  const current = await currentReportInput(tx, context, surveyId);
  return { approved: true as const, current: current?.fingerprint === latestApproved.fingerprint, versionNumber: latestApproved.versionNumber };
}
