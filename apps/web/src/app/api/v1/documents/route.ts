import {workspaceAudit} from "@/lib/workspace-audit";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { isManagementRole } from "@surveynt/domain";
import { auditEvents, backgroundJobs, createDatabase, jobs, organisationDocuments, organisationOperationalSettings, withTenant } from "@surveynt/db";
import { and, desc, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { documentAccess } from "@/lib/document-access";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { getObjectStorage, maxUploadBytes } from "@/lib/storage";

class DocumentChanged extends Error {}
const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
export async function GET(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (context.demo) return ok([], { demo: true });
  const archived = new URL(request.url).searchParams.get("archived") === "true";
  if (archived && !isManagementRole(context.role)) return problem(403, "forbidden", "Practice management access is required to review archived documents.");
  const {rows,incidents} = await withTenant(createDatabase(), context.organisationId, async tx => {
    const rows=await tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.organisationId, context.organisationId), (archived ? isNotNull(organisationDocuments.deletedAt) : isNull(organisationDocuments.deletedAt)), documentAccess(context.role, context.internalUserId))).orderBy(desc(organisationDocuments.createdAt)).limit(200);
    const keys=rows.filter(row=>row.purgeStatus==="verification_required").map(row=>`document-removal:${row.id}`);
    const incidents=keys.length?await tx.select({key:backgroundJobs.deduplicationKey,attempts:backgroundJobs.attempts,leaseToken:backgroundJobs.leaseToken}).from(backgroundJobs).where(and(eq(backgroundJobs.organisationId,context.organisationId),eq(backgroundJobs.queue,"document_removal"),eq(backgroundJobs.status,"verification_required"),inArray(backgroundJobs.deduplicationKey,keys))):[];
    return {rows,incidents};
  });
  return ok(rows.map((row) => ({ id: row.id, removalReview:incidents.find(incident=>incident.key===`document-removal:${row.id}`)??null, purgeStatus:row.purgeStatus, purgeRequestedAt:row.purgeRequestedAt, purgedAt:row.purgedAt, archivedAt: row.deletedAt, jobId: row.jobId, reportVersionId: row.reportVersionId, name: row.name, category: row.category, accessClass: row.accessClass, checksum: row.checksum, contentType: row.contentType, sizeBytes: row.sizeBytes, retentionUntil: row.retentionUntil, legalHold: row.legalHold, uploadedByUserId: row.uploadedByUserId, createdAt: row.createdAt, updatedAt: row.updatedAt })));
}

export async function POST(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context) || !isManagementRole(context.role)) return problem(403, "forbidden", "Your role cannot upload documents.");
  const storage = getObjectStorage(); if (!storage || context.demo) return problem(503, "storage_not_configured", "Private document storage is not configured.");
  const form = await request.formData().catch(() => null); const file = form?.get("file"); const category = String(form?.get("category") ?? "legal").slice(0, 80); const jobId = String(form?.get("jobId") ?? "") || null;
  const classification = z.enum(["firm", "job", "restricted"]).safeParse(form?.get("accessClass") ?? "firm");
  if (!classification.success) return problem(400, "invalid_access", "Choose a document access classification.");
  const replaceId=String(form?.get("replaceId")??"")||null,expectedChecksum=String(form?.get("expectedChecksum")??"");
  if (!replaceId && classification.data === "job" && !jobId) return problem(400, "job_required", "Select a practice job for job-scoped access.");
  if(replaceId&&!z.uuid().safeParse(replaceId).success)return problem(400,"invalid_document","Choose a document to replace.");
  if(jobId&&!z.uuid().safeParse(jobId).success)return problem(400,"invalid_job","Choose a valid job.");
  if(replaceId){const [current]=await withTenant(createDatabase(),context.organisationId,tx=>tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.id,replaceId),eq(organisationDocuments.organisationId,context.organisationId),isNull(organisationDocuments.deletedAt))).limit(1));if(!current)return problem(404,"document_not_found","Document not found.");if(current.legalHold)return problem(409,"legal_hold","This document is under legal hold. Its original cannot be replaced.");if(current.checksum!==expectedChecksum)return problem(409,"document_changed","Reload the document before replacing it.");}
  if (!(file instanceof File) || file.size < 1 || file.size > maxUploadBytes() || !allowed.has(file.type)) return problem(400, "invalid_file", "Upload a supported document within the configured size limit.");
  if (jobId) { const exists = await withTenant(createDatabase(), context.organisationId, (tx) => tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId))).limit(1)); if (!exists.length) return problem(400, "invalid_job", "The selected job does not belong to this practice."); }
  const body = await file.arrayBuffer(); const digest = await crypto.subtle.digest("SHA-256", body); const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); const id = crypto.randomUUID(); const storageKey = `organisations/${context.organisationId}/documents/${id}/original`;
  await storage.put(storageKey, body, file.type);
  try {
    const document = await withTenant(createDatabase(), context.organisationId, async (tx) => {
      const [previous]=replaceId?await tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.id,replaceId),eq(organisationDocuments.organisationId,context.organisationId),isNull(organisationDocuments.deletedAt))).for("update").limit(1):[];
      if(replaceId&&(!previous||previous.legalHold||previous.checksum!==expectedChecksum))throw new DocumentChanged("The document changed or entered legal hold. Reload before replacing it.");
      const [settings]=await tx.select({retentionDays:organisationOperationalSettings.documentRetentionDays}).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,context.organisationId)).limit(1);
      const [row] = await tx.insert(organisationDocuments).values({ id, organisationId: context.organisationId, jobId:previous?previous.jobId:jobId, reportVersionId:previous?.reportVersionId??null, name: file.name.slice(0, 240), category:previous?.category??category, accessClass:previous?.accessClass??classification.data, retentionUntil:previous?previous.retentionUntil:new Date(Date.now()+(settings?.retentionDays??2555)*86400000), blobUrl: `private://${storageKey}`, blobPathname: storageKey, checksum, contentType: file.type, sizeBytes: file.size, uploadedByUserId: context.internalUserId }).returning();
      if(previous)await tx.update(organisationDocuments).set({deletedAt:new Date(),updatedAt:new Date()}).where(and(eq(organisationDocuments.id,previous.id),eq(organisationDocuments.organisationId,context.organisationId)));
      await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: previous?"document.replaced":"document.uploaded", resourceType: "organisation_document", resourceId: row.id, metadata: { category:row.category, accessClass:row.accessClass, jobId:row.jobId, checksum, sizeBytes: file.size, previousDocumentId:previous?.id??null, previousChecksum:previous?.checksum??null, retainedOriginal:Boolean(previous) } })); return row;
    });
    return ok({ id: document.id, name: document.name, category: document.category, checksum: document.checksum, sizeBytes: document.sizeBytes });
  } catch (error) { await storage.remove(storageKey).catch(() => undefined); if(error instanceof DocumentChanged)return problem(409,"document_changed",error.message);throw error; }
}
