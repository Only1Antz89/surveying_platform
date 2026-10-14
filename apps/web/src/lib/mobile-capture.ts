import { and, desc, eq } from "drizzle-orm";
import { createDatabase, jobs, surveys, withTenant } from "@surveynt/db";
import type { OrganisationRole } from "@surveynt/domain";
import { readSurveyPack, type SurveyContext } from "./surveys";
import { listRooms } from "./floor-plans";

export type MobileContext = { organisationId: string; userId: string; role: OrganisationRole };
/** Mobile sessions already require recording permission; downstream checks re-verify it against the membership. */
export const surveyContextFor = (context: MobileContext): SurveyContext & { internalUserId: string } => ({ organisationId: context.organisationId, internalUserId: context.userId, role: context.role, canRecordSurvey: true });

/** What the companion needs to capture on site for one assigned job: the survey's inspectable elements, their status and the rooms recorded so far. */
export async function mobileCapture(context: MobileContext, jobId: string) {
  const surveyContext = surveyContextFor(context);
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [job] = await tx.select({ id: jobs.id, reference: jobs.reference }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId), eq(jobs.assignedSurveyorId, context.userId))).limit(1);
    if (!job) return null;
    const [survey] = await tx.select({ id: surveys.id }).from(surveys).where(and(eq(surveys.organisationId, context.organisationId), eq(surveys.jobId, jobId))).orderBy(desc(surveys.createdAt)).limit(1);
    if (!survey) return { job, survey: null };
    const pack = await readSurveyPack(tx, surveyContext, survey.id);
    if (!pack) return { job, survey: null };
    const status = new Map(pack.elements.map((element) => [`${element.sectionKey}.${element.elementKey}`, element]));
    const photos = new Map<string, number>();
    for (const media of pack.media) { const capture = media.captureContext as { sectionKey?: string; elementKey?: string } | null; if (media.kind === "photo" && capture?.sectionKey && capture.elementKey) photos.set(`${capture.sectionKey}.${capture.elementKey}`, (photos.get(`${capture.sectionKey}.${capture.elementKey}`) ?? 0) + 1); }
    return {
      job,
      survey: { id: pack.survey.id, status: pack.survey.status, editable: pack.survey.status === "in_progress" },
      sections: pack.template.sections.map((section) => ({ key: section.key, label: section.label, elements: section.elements.filter((element) => element.inspectable).map((element) => { const row = status.get(`${section.key}.${element.key}`); return { key: element.key, label: element.label, inspectionStatus: row?.inspectionStatus ?? null, limitationReason: row?.limitationReason ?? null, version: row?.version ?? null, photos: photos.get(`${section.key}.${element.key}`) ?? 0 }; }) })).filter((section) => section.elements.length),
      rooms: await listRooms(surveyContext, pack.survey.id) ?? [],
    };
  });
}
