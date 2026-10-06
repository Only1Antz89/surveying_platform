import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { createDatabase, evidenceLinks, jobs, mediaAssets, observations, surveyElements, surveys, withTenant } from "@surveynt/db";
import { relatedPropertyIds } from "./surveys";
import { assignedJobScope, type WorkspaceViewer } from "./workspace-scope";

export type EarlierPhoto = { mediaId: string; surveyId: string; jobReference: string; surveyDate: string; capturedAt: string | null; locationLabel: string | null };

/**
 * Photos of the same element from this firm's earlier surveys of the same
 * property (or the same surveyor-confirmed UPRN). They are shown for the
 * surveyor to compare on site. Any difference is a possible change, never a
 * finding, and no automatic comparison is made.
 */
export async function earlierPhotosForElement(context: WorkspaceViewer, surveyId: string, sectionKey: string, elementKey: string): Promise<EarlierPhoto[] | null> {
  const db = createDatabase();
  return withTenant(db, context.organisationId, async (tx) => {
    const [survey] = await tx.select().from(surveys).where(and(eq(surveys.id, surveyId), eq(surveys.organisationId, context.organisationId))).limit(1);
    if (!survey) return null;
    const related = await relatedPropertyIds(tx, context.organisationId, survey.propertyId);
    const earlier = await tx.select({ id: surveys.id, createdAt: surveys.createdAt, reference: jobs.reference }).from(surveys)
      .innerJoin(jobs, and(eq(surveys.jobId, jobs.id), eq(jobs.organisationId, context.organisationId)))
      .where(and(eq(surveys.organisationId, context.organisationId), inArray(surveys.propertyId, related), ne(surveys.id, survey.id), lt(surveys.createdAt, survey.createdAt), ne(surveys.status, "withdrawn"), assignedJobScope(context)))
      .orderBy(desc(surveys.createdAt)).limit(10);
    if (!earlier.length) return [];
    const elements = await tx.select({ id: surveyElements.id, surveyId: surveyElements.surveyId, locationLabel: surveyElements.locationLabel }).from(surveyElements)
      .where(and(eq(surveyElements.organisationId, context.organisationId), inArray(surveyElements.surveyId, earlier.map((row) => row.id)), eq(surveyElements.sectionKey, sectionKey), eq(surveyElements.elementKey, elementKey)));
    if (!elements.length) return [];
    const elementObservations = await tx.select({ id: observations.id, elementId: observations.elementId }).from(observations)
      .where(and(eq(observations.organisationId, context.organisationId), inArray(observations.elementId, elements.map((row) => row.id))));
    const targets = [...elements.map((row) => row.id), ...elementObservations.map((row) => row.id)];
    const links = await tx.select({ targetId: evidenceLinks.targetId, mediaId: evidenceLinks.evidenceId }).from(evidenceLinks)
      .where(and(eq(evidenceLinks.organisationId, context.organisationId), eq(evidenceLinks.evidenceType, "media"), inArray(evidenceLinks.targetId, targets)));
    if (!links.length) return [];
    const media = await tx.select().from(mediaAssets).where(and(eq(mediaAssets.organisationId, context.organisationId), eq(mediaAssets.kind, "photo"), eq(mediaAssets.status, "stored"), inArray(mediaAssets.id, [...new Set(links.map((link) => link.mediaId))])));
    const elementById = new Map(elements.map((row) => [row.id, row]));
    const observationElement = new Map(elementObservations.map((row) => [row.id, row.elementId]));
    return media.map((item) => {
      const link = links.find((entry) => entry.mediaId === item.id)!;
      const element = elementById.get(link.targetId) ?? elementById.get(observationElement.get(link.targetId) ?? "");
      const prior = earlier.find((row) => row.id === item.surveyId);
      return { mediaId: item.id, surveyId: item.surveyId ?? "", jobReference: prior?.reference ?? "", surveyDate: (prior?.createdAt ?? item.createdAt).toISOString().slice(0, 10), capturedAt: item.capturedAt?.toISOString() ?? null, locationLabel: element?.locationLabel || null };
    }).sort((a, b) => b.surveyDate.localeCompare(a.surveyDate)).slice(0, 12);
  });
}
