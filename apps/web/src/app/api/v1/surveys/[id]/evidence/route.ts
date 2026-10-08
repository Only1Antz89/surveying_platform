import { z } from "zod";
import { homeSurveyEvidenceInventory } from "@surveynt/assistant";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { loadSurveyPack } from "@/lib/surveys";
import { loadPropertyIntelligence } from "@/lib/intelligence";
import { PreinspectionError, readPreinspection, staffPreinspection } from "@/lib/preinspection";
import { listPreinspectionDocuments } from "@/lib/preinspection-documents";
import { externalFieldContext, questionnaireFieldContext } from "@/lib/survey-evidence-context";
import { preinspectionAnswersSchema, type CertificateFacts } from "@surveynt/assistant";

export const runtime = "nodejs";

/** Read-only contextual evidence. Applying an answer uses the professional proposal-review gate. */
export async function GET(request: Request, route: RouteContext<"/api/v1/surveys/[id]/evidence">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in to view survey evidence.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.demo) return ok({ sources: [], fields: [], preview: true });
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "Survey not found.");
  const pack = await loadSurveyPack(context, id);
  if (!pack) return problem(404, "survey_not_found", "Survey not found.");
  const intelligence = await loadPropertyIntelligence(context, pack.survey.propertyId);
  const sources = intelligence?.sources.map(source => {
    const categories = intelligence.categories.filter(category => category.sourceKey === source.key);
    return { key: source.key, name: source.name, enabled: source.enabled, coverageNotes: source.coverageNotes, guardrail: source.guardrail,
      status: !source.enabled ? "setup_required" : !source.coversProperty ? "unavailable" : !categories.length ? "not_checked" : categories.some(category => category.stale || !category.fresh) ? "stale" : categories.some(category => category.status === "matched") ? "available" : categories.some(category => category.status === "no_match") ? "no_record_found" : "unavailable",
      categories: categories.map(category => ({ category: category.category, status: category.status, coverage: category.coverage, message: category.message, retrievedAt: category.retrievedAt, fresh: category.fresh, stale: category.stale, datasetVersion: category.datasetVersion,
        evidence: category.records.flatMap(record => record.evidence), confidence: [...new Set(category.records.map(record => record.confidence).filter(Boolean))] })) };
  }) ?? [];
  const internal = (key: string, name: string, status: string, guardrail: string) => ({ key, name, enabled: status === "available", coverageNotes: "Practice-held evidence for this assigned job.", guardrail, status, categories: [] as typeof sources[number]["categories"] });
  const contexts = new Map<string, string[]>();
  sources.push(internal("job_record", "Property and job record", "available", "Scheduled dates and instructions require confirmation. They are not actual inspection observations."));
  sources.push(internal("practitioner_profile", "Your professional profile", pack.proposals.some(proposal => (proposal.evidenceRefs as { type?: string }[]).some(ref => ref.type === "practitioner_profile")) ? "available" : "not_checked", "Only the recording practitioner's own identity. Entered RICS numbers are self-declared."));
  sources.push(internal("firm_report_identity", "Approved firm report identity", pack.proposals.some(proposal => (proposal.evidenceRefs as { type?: string }[]).some(ref => ref.type === "firm_report_identity")) ? "available" : "not_checked", "Review reusable firm report identity before applying."));
  try {
    const collected = await staffPreinspection(context, pack.survey.jobId, async (tx, scope) => ({ questionnaire: await readPreinspection(tx, scope), documents: await listPreinspectionDocuments(tx, scope) }));
    sources.push(internal("customer_questionnaire", "Customer questionnaire", collected.questionnaire.submission ? "available" : "not_checked", "Submitted customer statements only; drafts never become evidence."));
    const documents = collected.documents.filter(document => !document.supersededAt && !document.originalRemovedAt);
    const answers = preinspectionAnswersSchema.safeParse(collected.questionnaire.submission?.answers);
    for (const field of homeSurveyEvidenceInventory(pack.template)) {
      const context = answers.success ? questionnaireFieldContext(field.path, answers.data) : [];
      if (field.sources.includes("document_extraction")) for (const document of documents) {
        const facts = document.analysis?.status === "completed" ? document.analysis.facts as CertificateFacts | undefined : undefined;
        if (!facts) continue;
        const values = [facts.reference, facts.issueDate, facts.inspectionDate, facts.dueDate].filter(Boolean);
        for (const fact of values) if (fact) context.push(`Uploaded document ${document.name}, page ${fact.span.page}: “${fact.span.excerpt}”. Unverified; not proof of current safety or compliance.`);
      }
      contexts.set(field.path, context);
    }
    sources.push(internal("document_extraction", "Uploaded certificates and guarantees", documents.some(document => document.analysis?.status === "completed") ? "available" : documents.length ? "unavailable" : "not_checked", "Unverified document text, not proof of safety, compliance or current guarantees. Scans need manual review."));
    sources.push(internal("confirmed_completion_document", "Works-completion documents", pack.proposals.some(proposal => (proposal.evidenceRefs as { type?: string; context?: string }[]).some(ref => ref.type === "document_span" && ref.context)) ? "available" : documents.length ? "not_checked" : "unavailable", "An explicit completion date and reviewed property/works association are required. Issue and permission dates are not completion dates."));
  } catch (error) {
    if (!(error instanceof PreinspectionError)) throw error;
    for (const key of ["customer_questionnaire", "document_extraction", "confirmed_completion_document"]) sources.push(internal(key, key.replace(/_/g, " "), error.status === 503 ? "setup_required" : "unavailable", "Collected evidence is unavailable for this membership or release state. Manual recording remains available."));
  }
  const fields = homeSurveyEvidenceInventory(pack.template).map(field => ({ ...field, context: [...(contexts.get(field.path) ?? []), ...externalFieldContext(field.path, intelligence?.categories ?? [])], pendingSuggestions: pack.proposals.filter(proposal => proposal.fieldPath === field.path).length }));
  return ok({ sources, fields, templateVersion: pack.template.version });
}
