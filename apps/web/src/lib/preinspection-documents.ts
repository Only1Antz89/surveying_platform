import "server-only";
import { verifiedSurveyFileOriginalRemoval, verifiedSurveyFileOriginalRemovalDates } from "./survey-file-original-removal-status";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { auditEvents, preinspectionDocuments, properties, type TenantTransaction } from "@surveynt/db";
import { analyseDocument } from "@surveynt/evidence";
import { currentProfessionalPermission } from "./professional-membership";
import { propertyFingerprint } from "./fingerprint";
import type { SurveyContext } from "./surveys";
import { z } from "zod";
import { PreinspectionError, type Scope } from "./preinspection";
import { getObjectStorage } from "./storage";
import { boundedQuestionnaireForm, validQuestionnaireFile } from "./questionnaire-file-validation";

const condition = (scope: Scope) => and(eq(preinspectionDocuments.organisationId, scope.organisationId), eq(preinspectionDocuments.jobId, scope.jobId), eq(preinspectionDocuments.propertyId, scope.propertyId));
export async function listPreinspectionDocuments(tx: TenantTransaction, scope: Scope) {
  const rows = await tx.select({ id: preinspectionDocuments.id, name: preinspectionDocuments.name, contentType: preinspectionDocuments.contentType, sizeBytes: preinspectionDocuments.sizeBytes, checksum: preinspectionDocuments.checksum, createdAt: preinspectionDocuments.createdAt, supersededAt: preinspectionDocuments.supersededAt, replacesId: preinspectionDocuments.replacesId, analysis: preinspectionDocuments.analysis, worksKind: preinspectionDocuments.worksKind, associatedAt: preinspectionDocuments.associatedAt }).from(preinspectionDocuments).where(condition(scope)).orderBy(desc(preinspectionDocuments.createdAt)).limit(100);
  const removed = await verifiedSurveyFileOriginalRemovalDates(tx, scope.organisationId, "questionnaire", rows.map(row => row.id));
  return rows.map(row => ({ ...row, analysis: removed.has(row.id) ? null : row.analysis, originalRemovedAt: removed.get(row.id) ?? null }));
}
export async function uploadPreinspectionDocument(tx: TenantTransaction, scope: Scope, request: Request, stored: { key: string | null }) {
  const storage = getObjectStorage();
  if (!storage) throw new PreinspectionError(503, "storage_not_configured", "Private document storage is not configured. Questionnaire text remains available.");
  let form: FormData;
  try { form = await boundedQuestionnaireForm(request); } catch { throw new PreinspectionError(400, "invalid_upload", "Upload one PDF, JPEG or PNG within 10 MB."); }
  const file = form.get("file"); const requestId = form.get("requestId"); const replacesId = form.get("replacesId") || null;
  if (!(file instanceof File) || !z.uuid().safeParse(requestId).success || (replacesId && !z.uuid().safeParse(replacesId).success)) throw new PreinspectionError(400, "invalid_upload", "A valid file and upload identifier are required.");
  const bytes = await file.arrayBuffer();
  if (!validQuestionnaireFile(new Uint8Array(bytes), file.type)) throw new PreinspectionError(400, "invalid_file", "Upload a valid PDF, JPEG or PNG within 10 MB. The file contents must match its type.");
  const checksum = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
  const [existing] = await tx.select().from(preinspectionDocuments).where(and(condition(scope), eq(preinspectionDocuments.requestId, String(requestId)))).limit(1);
  if (existing) {
    if (existing.checksum !== checksum || existing.replacesId !== replacesId || existing.source !== scope.source) throw new PreinspectionError(409, "upload_conflict", "This upload identifier was already used for another document.");
    return { id: existing.id, duplicate: true };
  }
  const all = await listPreinspectionDocuments(tx, scope);
  if (all.length >= 100 || (!replacesId && all.filter(item => !item.supersededAt).length >= 20)) throw new PreinspectionError(409, "document_limit", "This job's document limit has been reached. Contact the practice.");
  const [previous] = replacesId ? await tx.select().from(preinspectionDocuments).where(and(condition(scope), eq(preinspectionDocuments.id, String(replacesId)), isNull(preinspectionDocuments.supersededAt))).for("update").limit(1) : [];
  if (replacesId && !previous) throw new PreinspectionError(409, "document_changed", "This document is unavailable or has already been replaced. Reload the list.");
  if (previous && await verifiedSurveyFileOriginalRemoval(tx, scope.organisationId, "questionnaire", previous.id)) throw new PreinspectionError(410, "original_removed", "This original was removed after its retention review and cannot be replaced.");
  const id = randomUUID(); const key = `organisations/${scope.organisationId}/preinspection/${scope.jobId}/${id}/original`;
  const analysis = file.type === "application/pdf" ? await analyseDocument(new Uint8Array(bytes), { asOf: new Date().toISOString().slice(0, 10), maxPages: 30 }) : { status: "unavailable", reason: "Image document: manual review required. No OCR service is enabled." };
  stored.key = key; await storage.put(key, bytes, file.type);
  await tx.insert(preinspectionDocuments).values({ id, organisationId: scope.organisationId, jobId: scope.jobId, propertyId: scope.propertyId, requestId: String(requestId), name: file.name.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 240), contentType: file.type, sizeBytes: file.size, checksum, storageKey: key, replacesId: previous?.id, source: scope.source, actorUserId: scope.actorUserId, analysis: analysis as unknown as Record<string, unknown> });
  if (previous) await tx.update(preinspectionDocuments).set({ supersededAt: new Date() }).where(eq(preinspectionDocuments.id, previous.id));
  await tx.insert(auditEvents).values({ organisationId: scope.organisationId, actorUserId: scope.actorUserId, action: previous ? "questionnaire.document_replaced" : "questionnaire.document_uploaded", resourceType: "preinspection_document", resourceId: id, metadata: { jobId: scope.jobId, checksum, previousDocumentId: previous?.id ?? null, originalRetained: Boolean(previous) } });
  return { id, duplicate: false };
}

export async function confirmDocumentWorks(tx: TenantTransaction, scope: Scope, context: SurveyContext, id: string, input: unknown) {
  if (!await currentProfessionalPermission(tx, context, "record_survey")) throw new PreinspectionError(403, "professional_recording_required", "Recording permission is required to confirm professional evidence association.");
  const parsed = z.object({ worksKind: z.enum(["extension", "conversion"]), checksum: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(1000), confirm: z.literal(true) }).strict().safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(id).success) throw new PreinspectionError(400, "invalid_association", "Confirm the property, relevant works, original document and reason.");
  const [row] = await tx.select().from(preinspectionDocuments).where(and(condition(scope), eq(preinspectionDocuments.id, id), isNull(preinspectionDocuments.supersededAt))).for("update").limit(1);
  if (!row || row.checksum !== parsed.data.checksum) throw new PreinspectionError(409, "document_changed", "The document changed or was replaced.");
  if (await verifiedSurveyFileOriginalRemoval(tx, scope.organisationId, "questionnaire", row.id)) throw new PreinspectionError(410, "original_removed", "This original was removed after its retention review and cannot be associated with works.");
  const [property] = await tx.select().from(properties).where(and(eq(properties.id, scope.propertyId), eq(properties.organisationId, scope.organisationId))).for("share").limit(1);
  if (!property) throw new PreinspectionError(404, "property_unavailable", "Property unavailable.");
  await tx.update(preinspectionDocuments).set({ worksKind: parsed.data.worksKind, associationFingerprint: await propertyFingerprint(property), associatedAt: new Date(), associatedByUserId: context.internalUserId, associationReason: parsed.data.reason }).where(eq(preinspectionDocuments.id, id));
  await tx.insert(auditEvents).values({ organisationId: scope.organisationId, actorUserId: context.internalUserId, action: "questionnaire.document_works_confirmed", resourceType: "preinspection_document", resourceId: id, metadata: { jobId: scope.jobId, worksKind: parsed.data.worksKind, checksum: row.checksum, reason: parsed.data.reason } });
  return { confirmed: true };
}
export async function downloadPreinspectionDocument(tx: TenantTransaction, scope: Scope, id: string) {
  if (!z.uuid().safeParse(id).success) throw new PreinspectionError(404, "document_unavailable", "Document unavailable.");
  const [row] = await tx.select().from(preinspectionDocuments).where(and(condition(scope), eq(preinspectionDocuments.id, id))).limit(1);
  if (!row) throw new PreinspectionError(404, "document_unavailable", "Document unavailable.");
  if (await verifiedSurveyFileOriginalRemoval(tx, row.organisationId, "questionnaire", row.id)) throw new PreinspectionError(410, "original_removed", "This original was removed after its retention review.");
  const object = await getObjectStorage()?.get(row.storageKey);
  if (!object) throw new PreinspectionError(503, "document_unavailable", "The private document could not be retrieved.");
  return new Response(object.stream, { headers: { "content-type": row.contentType, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox" } });
}
