import { canMutateOperations } from "@surveynt/domain";
import { auditEvents, createDatabase, jobs, organisationDocuments, withTenant } from "@surveynt/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { getObjectStorage, maxUploadBytes } from "@/lib/storage";

const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
export async function GET(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required.");
  if (context.demo) return ok([], { demo: true });
  const rows = await withTenant(createDatabase(), context.organisationId, (tx) => tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.organisationId, context.organisationId), isNull(organisationDocuments.deletedAt))).orderBy(desc(organisationDocuments.createdAt)).limit(200));
  return ok(rows.map((row) => ({ id: row.id, jobId: row.jobId, reportVersionId: row.reportVersionId, name: row.name, category: row.category, accessClass: row.accessClass, checksum: row.checksum, contentType: row.contentType, sizeBytes: row.sizeBytes, retentionUntil: row.retentionUntil, legalHold: row.legalHold, uploadedByUserId: row.uploadedByUserId, createdAt: row.createdAt, updatedAt: row.updatedAt })));
}

export async function POST(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required.");
  if (!canWriteWorkspace(context) || !canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot upload documents.");
  const storage = getObjectStorage(); if (!storage || context.demo) return problem(503, "storage_not_configured", "Private document storage is not configured.");
  const form = await request.formData().catch(() => null); const file = form?.get("file"); const category = String(form?.get("category") ?? "legal").slice(0, 80); const jobId = String(form?.get("jobId") ?? "") || null;
  if (!(file instanceof File) || file.size < 1 || file.size > maxUploadBytes() || !allowed.has(file.type)) return problem(400, "invalid_file", "Upload a supported document within the configured size limit.");
  if (jobId) { const exists = await withTenant(createDatabase(), context.organisationId, (tx) => tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId))).limit(1)); if (!exists.length) return problem(400, "invalid_job", "The selected job does not belong to this practice."); }
  const body = await file.arrayBuffer(); const digest = await crypto.subtle.digest("SHA-256", body); const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); const id = crypto.randomUUID(); const storageKey = `organisations/${context.organisationId}/documents/${id}/original`;
  await storage.put(storageKey, body, file.type);
  try {
    const document = await withTenant(createDatabase(), context.organisationId, async (tx) => {
      const [row] = await tx.insert(organisationDocuments).values({ id, organisationId: context.organisationId, jobId, name: file.name.slice(0, 240), category, accessClass: "firm", blobUrl: `private://${storageKey}`, blobPathname: storageKey, checksum, contentType: file.type, sizeBytes: file.size, uploadedByUserId: context.internalUserId }).returning();
      await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "document.uploaded", resourceType: "organisation_document", resourceId: row.id, metadata: { category, jobId, checksum, sizeBytes: file.size } }); return row;
    });
    return ok({ id: document.id, name: document.name, category: document.category, checksum: document.checksum, sizeBytes: document.sizeBytes });
  } catch (error) { await storage.remove(storageKey).catch(() => undefined); throw error; }
}
