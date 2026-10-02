import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import { CERTIFICATE_EXTRACTOR, certificateTypeLabels, type CertificateFacts } from "@surveynt/assistant";
import { assistantTasks, createDatabase, mediaAnalyses, mediaAssets, surveyFieldValues, withTenant } from "@surveynt/db";
import { analyseDocument, analysePhoto, PHOTO_ANALYSER } from "@surveynt/evidence";
import { getObjectStorage } from "./storage";

async function readAll(stream: ReadableStream<Uint8Array>, limit: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > limit) throw new Error("Stored object is larger than recorded.");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Runs the deterministic analyser for one stored photo or PDF and keeps the
 * result. Idempotent per media item and analyser version. An expired
 * certificate raises a discrepancy task for the surveyor; nothing changes the
 * form or the original file.
 */
export async function analyseStoredMedia(context: { organisationId: string }, mediaId: string): Promise<"analysed" | "already_analysed" | "missing" | "unsupported"> {
  const db = createDatabase();
  const loaded = await withTenant(db, context.organisationId, async (tx) => {
    const [media] = await tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, mediaId), eq(mediaAssets.organisationId, context.organisationId), eq(mediaAssets.status, "stored"))).limit(1);
    if (!media) return null;
    const analyser = media.kind === "photo" ? PHOTO_ANALYSER : media.contentType === "application/pdf" ? CERTIFICATE_EXTRACTOR : null;
    if (!analyser) return { media, analyser, existing: null, inspectionDate: null };
    const [existing] = await tx.select({ id: mediaAnalyses.id }).from(mediaAnalyses).where(and(eq(mediaAnalyses.mediaId, media.id), eq(mediaAnalyses.analyser, analyser), eq(mediaAnalyses.organisationId, context.organisationId))).limit(1);
    const [inspection] = media.surveyId ? await tx.select({ value: surveyFieldValues.value }).from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, media.surveyId), eq(surveyFieldValues.organisationId, context.organisationId), eq(surveyFieldValues.fieldPath, "inspection.visit.inspection_date"), isNull(surveyFieldValues.supersededAt))).limit(1) : [];
    const value = inspection?.value as { state?: string; value?: unknown } | undefined;
    return { media, analyser, existing: (existing as { id: string } | undefined) ?? null, inspectionDate: value?.state === "provided" && typeof value.value === "string" && isoDate.test(value.value) ? value.value : null };
  });
  if (!loaded) return "missing";
  if (!loaded.analyser) return "unsupported";
  if (loaded.existing) return "already_analysed";
  const { media, analyser } = loaded;

  let status: "completed" | "unavailable" | "failed" = "failed";
  let result: Record<string, unknown> = {};
  let facts: CertificateFacts | null = null;
  let checks: { code: string; title: string; detail: string; span: unknown }[] = [];
  try {
    const object = await getObjectStorage()?.get(media.storageKey);
    if (!object) throw new Error("The stored original could not be read.");
    const bytes = await readAll(object.stream, media.byteSize);
    if (media.kind === "photo") {
      const quality = await analysePhoto(bytes);
      status = quality.status;
      result = quality as unknown as Record<string, unknown>;
    } else {
      // Validity is judged against the recorded inspection date, or today when none is recorded yet.
      const asOf = loaded.inspectionDate ?? new Date().toISOString().slice(0, 10);
      const analysis = await analyseDocument(bytes, { asOf });
      status = analysis.status;
      result = { ...analysis, asOf } as unknown as Record<string, unknown>;
      if (analysis.status === "completed") { facts = analysis.facts; checks = analysis.checks; }
    }
  } catch (reason) {
    status = "failed";
    result = { error: reason instanceof Error ? reason.message.slice(0, 300) : "Analysis failed." };
  }

  await withTenant(db, context.organisationId, async (tx) => {
    const [inserted] = await tx.insert(mediaAnalyses).values({ organisationId: context.organisationId, mediaId: media.id, surveyId: media.surveyId, analyser, status, result }).onConflictDoNothing().returning({ id: mediaAnalyses.id });
    if (!inserted || !media.surveyId) return;
    for (const check of checks.filter((item) => item.code === "expired")) {
      await tx.insert(assistantTasks).values({
        organisationId: context.organisationId, surveyId: media.surveyId, kind: "discrepancy", dedupeKey: `document:${media.id}:expired`, fieldPath: "matters.legal.guarantees",
        title: check.title, detail: `${check.detail} Extracted from an uploaded document: check the original.`,
        evidence: { type: "document_span", mediaId: media.id, analysisId: inserted.id, analyser, span: check.span, documentType: facts?.documentType ? certificateTypeLabels[facts.documentType.value] : null },
      }).onConflictDoNothing();
    }
  });
  return "analysed";
}

/** Daily backfill for uploads whose after-response analysis did not run (owner connection, bounded). */
export async function processMediaAnalysisBacklog(limit = 20) {
  if (!process.env.DATABASE_ADMIN_URL) return { analysed: 0 };
  const admin = createDatabase(process.env.DATABASE_ADMIN_URL);
  const since = new Date(Date.now() - 14 * 86_400_000);
  const pending = await admin.select({ id: mediaAssets.id, organisationId: mediaAssets.organisationId }).from(mediaAssets)
    .leftJoin(mediaAnalyses, eq(mediaAnalyses.mediaId, mediaAssets.id))
    .where(and(eq(mediaAssets.status, "stored"), gte(mediaAssets.createdAt, since), isNull(mediaAnalyses.id), or(eq(mediaAssets.kind, "photo"), eq(mediaAssets.contentType, "application/pdf"))))
    .orderBy(desc(mediaAssets.createdAt)).limit(Math.max(1, Math.min(limit, 100)));
  let analysed = 0;
  for (const media of pending) if ((await analyseStoredMedia({ organisationId: media.organisationId }, media.id).catch(() => "failed")) === "analysed") analysed += 1;
  return { analysed, pending: pending.length };
}
