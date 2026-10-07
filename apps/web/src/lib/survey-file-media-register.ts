import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { evidenceLinks, mediaAssets, reportVersions, surveys, type TenantTransaction } from "@surveynt/db";
import { z } from "zod";

const limit = 5000;
function complete<T>(rows: T[]): T[] {
  if (rows.length > limit) throw new Error("The survey evidence exceeds the review register limit.");
  return rows;
}
export async function readSurveyFileMedia(tx: TenantTransaction, organisationId: string, jobId: string, traces: Record<string, unknown>[]) {
  const surveyRows = complete(await tx.select({ id: surveys.id }).from(surveys).where(and(eq(surveys.organisationId, organisationId), eq(surveys.jobId, jobId))).orderBy(asc(surveys.id)).limit(limit + 1));
  const surveyIds = surveyRows.map(survey => survey.id);
  const links = surveyIds.length ? complete(await tx.select({ id: evidenceLinks.id, surveyId: evidenceLinks.surveyId, evidenceType: evidenceLinks.evidenceType, evidenceId: evidenceLinks.evidenceId, removedAt: evidenceLinks.removedAt }).from(evidenceLinks).where(and(eq(evidenceLinks.organisationId, organisationId), inArray(evidenceLinks.surveyId, surveyIds))).orderBy(asc(evidenceLinks.id)).limit(limit + 1)) : [];
  const traceValid = traces.every(trace => Array.isArray(trace.media) && trace.media.every(id => typeof id === "string"));
  const references = [...new Set([...traces.flatMap(trace => Array.isArray(trace.media) ? trace.media.filter((id): id is string => typeof id === "string") : []), ...links.filter(link => link.evidenceType === "media").map(link => link.evidenceId)])];
  if (references.length > limit) throw new Error("The survey evidence exceeds the review register limit.");
  const uuidReferences = references.filter(id => z.uuid().safeParse(id).success);
  const selection = { id: mediaAssets.id, surveyId: mediaAssets.surveyId, checksum: mediaAssets.sha256, byteSize: mediaAssets.byteSize, kind: mediaAssets.kind, filename: mediaAssets.originalFilename, status: mediaAssets.status, deletedAt: mediaAssets.deletedAt, parentId: mediaAssets.derivedFromId, derivation: mediaAssets.derivation, clientGeneratedId: mediaAssets.clientGeneratedId };
  const initial = complete(await tx.select(selection).from(mediaAssets).where(and(eq(mediaAssets.organisationId, organisationId), or(surveyIds.length ? inArray(mediaAssets.surveyId, surveyIds) : sql`false`, uuidReferences.length ? inArray(mediaAssets.id, uuidReferences) : undefined, references.length ? inArray(mediaAssets.clientGeneratedId, references) : undefined))).orderBy(asc(mediaAssets.id)).limit(limit + 1));
  const media = new Map(initial.map(row => [row.id, row]));
  // Include both original ancestors and all derived copies, even when stored under another survey.
  let frontier = initial;
  while (frontier.length) {
    const ids = frontier.map(row => row.id);
    const parents = frontier.flatMap(row => row.parentId && !media.has(row.parentId) ? [row.parentId] : []);
    const related = complete(await tx.select(selection).from(mediaAssets).where(and(eq(mediaAssets.organisationId, organisationId), or(inArray(mediaAssets.derivedFromId, ids), parents.length ? inArray(mediaAssets.id, parents) : undefined))).orderBy(asc(mediaAssets.id)).limit(limit + 1));
    frontier = related.filter(row => !media.has(row.id));
    for (const row of frontier) media.set(row.id, row);
    if (media.size > limit) throw new Error("The survey evidence exceeds the review register limit.");
  }
  const rows = [...media.values()].sort((a, b) => a.id.localeCompare(b.id));
  const identities = [...new Set(rows.flatMap(row => [row.id, row.clientGeneratedId]))];
  const unresolvedReferences = references.filter(reference => !identities.includes(reference));
  const externalLinks = identities.length || surveyIds.length ? complete(await tx.select({ id: evidenceLinks.id, surveyId: evidenceLinks.surveyId, evidenceType: evidenceLinks.evidenceType, evidenceId: evidenceLinks.evidenceId, removedAt: evidenceLinks.removedAt }).from(evidenceLinks).where(and(eq(evidenceLinks.organisationId, organisationId), or(identities.length ? and(eq(evidenceLinks.evidenceType, "media"), inArray(evidenceLinks.evidenceId, identities)) : undefined, surveyIds.length ? and(eq(evidenceLinks.evidenceType, "prior_survey"), inArray(evidenceLinks.evidenceId, surveyIds)) : undefined), surveyIds.length ? sql`${evidenceLinks.surveyId} <> all(array[${sql.join(surveyIds.map(id => sql`${id}::uuid`), sql`, `)}])` : undefined)).orderBy(asc(evidenceLinks.id)).limit(limit + 1)) : [];
  const externalReports = identities.length ? complete(await tx.select({ id: reportVersions.id, jobId: reportVersions.jobId, checksum: reportVersions.contentSha256 }).from(reportVersions).where(and(eq(reportVersions.organisationId, organisationId), ne(reportVersions.jobId, jobId), sql`(${reportVersions.trace}->'media') ?| array[${sql.join(identities.map(id => sql`${id}::text`), sql`, `)}]`)).orderBy(asc(reportVersions.id)).limit(limit + 1)) : [];
  const cyclicDerivation = rows.some(row => {
    const seen = new Set<string>(); let current: typeof row | undefined = row;
    while (current?.parentId) { if (seen.has(current.id)) return true; seen.add(current.id); current = media.get(current.parentId); if (!current) return true; }
    return false;
  });
  return { media: rows, evidenceLinks: links, externalLinks, externalReports, unresolvedReferences, referenceReviewRequired: !traceValid || cyclicDerivation || unresolvedReferences.length > 0 || externalLinks.length > 0 || externalReports.length > 0 || rows.some(row => row.surveyId !== null && !surveyIds.includes(row.surveyId)) };
}
