import { and, desc, eq, ne } from "drizzle-orm";
import { checkOverrides, type CompletionOverride, type CompletionReport, type OverrideCheck } from "@surveynt/assistant";
import { auditEvents, completionOverrides, createDatabase, surveys, withTenant, type TenantTransaction } from "@surveynt/db";
import type { JobStage } from "@surveynt/domain";
import { completionReportFromPack } from "./completion-input";
import { canRecordProfessionalJudgement, readSurveyPack, type SurveyContext } from "./surveys";

/** Stages that need the survey's completion checks to pass (or an audited override). */
export const gatedStages: readonly JobStage[] = ["internal_review", "issued"];

export async function checkSurveyCompletion(context: Pick<SurveyContext, "organisationId">, surveyId: string): Promise<CompletionReport | "missing" | "no_rules"> {
  const db = createDatabase();
  const pack = await withTenant(db, context.organisationId, (tx) => readSurveyPack(tx, context, surveyId));
  if (!pack) return "missing";
  return completionReportFromPack(pack) ?? "no_rules";
}

export type StageGateOutcome =
  | { kind: "not_gated" }
  | { kind: "passed"; surveyId: string; report: CompletionReport; overridden: number }
  | { kind: "blocked"; surveyId: string; report: CompletionReport; check: OverrideCheck; mayOverride: boolean };

/**
 * Runs inside the stage-change transaction. Jobs without a survey are not
 * gated (records created before survey capture existed). With failing hard
 * gates the change is refused unless every failure has a permitted override
 * from a surveyor role; accepted overrides are stored and audited.
 */
export async function enforceStageGate(tx: TenantTransaction, context: SurveyContext, input: { jobId: string; targetStage: JobStage; overrides: CompletionOverride[] }): Promise<StageGateOutcome> {
  if (!gatedStages.includes(input.targetStage)) return { kind: "not_gated" };
  const [survey] = await tx.select({ id: surveys.id }).from(surveys)
    .where(and(eq(surveys.organisationId, context.organisationId), eq(surveys.jobId, input.jobId), ne(surveys.status, "withdrawn")))
    .orderBy(desc(surveys.createdAt)).limit(1);
  if (!survey) return { kind: "not_gated" };
  const pack = await readSurveyPack(tx, context, survey.id);
  const report = pack ? completionReportFromPack(pack) : null;
  if (!report) throw new Error("No completion rule set is available for this survey's template.");
  if (report.ready) return { kind: "passed", surveyId: survey.id, report, overridden: 0 };
  const mayOverride = canRecordProfessionalJudgement(context.role);
  const check = checkOverrides(report, mayOverride ? input.overrides : []);
  if (!check.ok || !mayOverride) return { kind: "blocked", surveyId: survey.id, report, check, mayOverride };
  await tx.insert(completionOverrides).values(check.accepted.map((override) => ({
    organisationId: context.organisationId, jobId: input.jobId, surveyId: survey.id, itemId: override.itemId, category: override.item.category, ruleId: override.item.ruleId,
    ruleSetKey: report.ruleSetKey, ruleSetVersion: report.ruleSetVersion, templateVersion: report.templateVersion, targetStage: input.targetStage,
    reason: override.reason, note: override.note?.trim() || null, overriddenByUserId: context.internalUserId,
  })));
  await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "survey.completion_overridden", resourceType: "survey", resourceId: survey.id, metadata: { jobId: input.jobId, targetStage: input.targetStage, ruleSetVersion: report.ruleSetVersion, items: check.accepted.map((item) => ({ itemId: item.itemId, reason: item.reason })) } });
  return { kind: "passed", surveyId: survey.id, report, overridden: check.accepted.length };
}

/** Problem details for a blocked stage change: failing hard gates and why any override was refused. */
export function stageGateProblem(outcome: Extract<StageGateOutcome, { kind: "blocked" }>) {
  return {
    surveyId: outcome.surveyId,
    ruleSetVersion: outcome.report.ruleSetVersion,
    mayOverride: outcome.mayOverride,
    failures: outcome.check.unresolved.map((item) => ({ id: item.id, title: item.title, detail: item.detail, category: item.category, overrideReasons: item.overrideReasons, justification: item.justification })),
    invalidOverrides: outcome.check.invalid,
  };
}
