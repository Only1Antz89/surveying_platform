import { and, desc, eq } from "drizzle-orm";
import { createDatabase, organisationOperationalSettings, reportApprovals, reportVersions, withTenant } from "@surveynt/db";
import type { ComposedReport } from "@surveynt/assistant";
import { currentReportInput } from "./reports";
import { readSurveyMedia, type SurveyContext } from "./surveys";
import { activeReportTemplates } from "./report-template-settings";
import { centralRicsTemplate } from "./rics-template-catalogue";
import { PdfOutputError, renderLicensedReportPdf, type OutputPhoto } from "./licensed-report-pdf";

export class RicsOutputError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

/**
 * The licensed RICS PDF for a survey's latest report version. Review copies are always
 * watermarked; a final copy needs the latest version to be signed off and still current.
 */
export async function ricsReportPdf(context: Pick<SurveyContext, "organisationId"> & Partial<SurveyContext>, surveyId: string, options: { final: boolean }) {
  const snapshot = await withTenant(createDatabase(), context.organisationId, async (tx) => {
    const current = await currentReportInput(tx, context, surveyId);
    if (!current) return null;
    const [latest] = await tx.select({ version: reportVersions, approvedAt: reportApprovals.createdAt }).from(reportVersions).leftJoin(reportApprovals, eq(reportApprovals.reportVersionId, reportVersions.id)).where(and(eq(reportVersions.surveyId, surveyId), eq(reportVersions.organisationId, context.organisationId))).orderBy(desc(reportVersions.versionNumber)).limit(1);
    const [settings] = await tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, context.organisationId)).limit(1);
    return { ...current, version: latest?.version, approvedAt: latest?.approvedAt ?? null, entitled: activeReportTemplates(settings?.reportTemplateSettings ?? null).some((row) => row.templateKey === current.pack.template.key && row.templateVersion === current.pack.template.version) };
  });
  if (!snapshot) throw new RicsOutputError(404, "survey_not_found", "The survey could not be found.");
  if (!snapshot.entitled) throw new RicsOutputError(409, "licence_configuration_required", "An active company licence for this pinned template is required in Admin settings.");
  if (!snapshot.version) throw new RicsOutputError(409, "report_required", "Compose a report version first.");
  if (snapshot.version.content.retentionRemoved) throw new RicsOutputError(410, "report_content_removed", "This report was removed after retention review.");
  if (snapshot.version.inputFingerprint !== snapshot.fingerprint) throw new RicsOutputError(409, "out_of_date", "Compose a new version from the current survey answers first.");
  if (options.final && !snapshot.approvedAt) throw new RicsOutputError(409, "not_signed_off", "The report has not been signed off yet.");
  try {
    const asset = await centralRicsTemplate(snapshot.pack.template);
    if (!asset) throw new RicsOutputError(409, "rics_output_unavailable", "Surveyant’s authorised central RICS template has not yet been provisioned for this version.");
    const photos: OutputPhoto[] = [];
    const mediaIds = new Set(snapshot.pack.evidence.filter((link) => link.evidenceType === "media").map((link) => link.evidenceId));
    let totalBytes = 0;
    for (const mediaId of mediaIds) {
      if (!snapshot.pack.media.some((media) => media.id === mediaId)) throw new PdfOutputError("A linked photograph is missing from this survey.");
      const loaded = await readSurveyMedia(context, mediaId);
      if (!loaded || "removed" in loaded) throw new PdfOutputError("A linked photograph is unavailable; the PDF was not exported.");
      if (loaded.media.kind === "video") throw new PdfOutputError("Linked video requires a published customer media supplement. This PDF cannot include or silently omit it yet.");
      if (loaded.media.kind !== "photo") continue;
      const bytes = new Uint8Array(await new Response(loaded.object.stream).arrayBuffer()); totalBytes += bytes.length;
      if (totalBytes > 50 * 1024 * 1024) throw new PdfOutputError("Photographs exceed the 50 MB export limit.");
      photos.push({ id: mediaId, label: loaded.media.originalFilename ?? "Survey photograph", bytes, contentType: loaded.media.contentType });
    }
    const bytes = await renderLicensedReportPdf({ bytes: asset.bytes, definition: asset.definition, template: snapshot.pack.template, report: snapshot.version.content as unknown as ComposedReport, answers: snapshot.pack.values, photos, draft: !options.final });
    return { bytes, filename: options.final ? `survey-report-v${snapshot.version.versionNumber}.pdf` : `survey-review-v${snapshot.version.versionNumber}.pdf` };
  } catch (error) {
    if (error instanceof RicsOutputError) throw error;
    if (error instanceof PdfOutputError) throw new RicsOutputError(422, "pdf_output_failed", error.message);
    throw new RicsOutputError(503, "rics_output_unavailable", "The central RICS output is unavailable or failed verification. Contact Surveyant support.");
  }
}
