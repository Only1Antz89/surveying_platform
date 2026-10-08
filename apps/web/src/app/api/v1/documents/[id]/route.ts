import {workspaceAudit} from "@/lib/workspace-audit";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { isManagementRole } from "@surveynt/domain";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { auditEvents, createDatabase, organisationDocuments, withTenant } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { problem } from "@/lib/api";
import { getObjectStorage } from "@/lib/storage";
import { z } from "zod";
import { ok, parseBody } from "@/lib/api";
import { documentAccess } from "@/lib/document-access";
import { demoDocumentText, isDemoOrganisation } from "@/lib/stakeholder-demo";

const metadataSchema = z.object({ category: z.string().trim().min(1).max(80), retentionUntil: z.iso.datetime().nullable(), legalHold: z.boolean(), accessClass: z.enum(["firm", "job", "restricted"]).optional() });

export async function PATCH(request: Request, route: RouteContext<"/api/v1/documents/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication is required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context) || !isManagementRole(context.role)) return problem(403, "forbidden", "Only practice managers can manage document protection.");
  const parsed = await parseBody(request, metadataSchema);
  if (!parsed.success) return problem(400, "invalid_request", "Check the category, retention date and legal hold.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "document_not_found", "The document could not be found.");
  const result = await withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [current] = await tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.id, id), eq(organisationDocuments.organisationId, context.organisationId), isNull(organisationDocuments.deletedAt))).for("update");
    if (!current) return null;
    if (parsed.data.accessClass === "job" && !current.jobId) return { invalidJobAccess: true as const };
    const [updated] = await tx.update(organisationDocuments).set({ category: parsed.data.category, retentionUntil: parsed.data.retentionUntil ? new Date(parsed.data.retentionUntil) : null, legalHold: parsed.data.legalHold, accessClass: parsed.data.accessClass ?? current.accessClass, updatedAt: new Date() }).where(and(eq(organisationDocuments.id, id), eq(organisationDocuments.organisationId, context.organisationId))).returning();
    await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "document.protection_changed", resourceType: "organisation_document", resourceId: id, metadata: { previous: { category: current.category, retentionUntil: current.retentionUntil, legalHold: current.legalHold, accessClass: current.accessClass }, next: parsed.data, checksum: current.checksum } }));
    return updated;
  });
  if (result && "invalidJobAccess" in result) return problem(400, "job_required", "A job-scoped document must already be linked to a practice job.");
  return result ? ok({ id: result.id, category: result.category, retentionUntil: result.retentionUntil, legalHold: result.legalHold, accessClass: result.accessClass }) : problem(404, "document_not_found", "The document could not be found.");
}

export async function GET(request: Request, route: RouteContext<"/api/v1/documents/[id]">) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required."); const { id } = await route.params;
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const [document] = context.demo ? [] : await withTenant(createDatabase(), context.organisationId, (tx) => tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.id, id), eq(organisationDocuments.organisationId, context.organisationId), isNull(organisationDocuments.deletedAt), documentAccess(context.role, context.internalUserId))).limit(1));
  if(document?.blobPathname==="demo://practice-checklist"&&await isDemoOrganisation(context.organisationId))return new Response(demoDocumentText,{headers:{"content-type":"text/plain; charset=utf-8","cache-control":"private, no-store","x-content-type-options":"nosniff","content-disposition":"attachment; filename=demo-practice-checklist.txt"}});
  const object = document ? await getObjectStorage()?.get(document.blobPathname) : null; if (!document || !object) return problem(404, "document_not_found", "The document could not be found.");
  return new Response(object.stream, { headers: { "content-type": document.contentType, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": `attachment; filename="${document.name.replace(/["\r\n]/g, "")}"` } });
}
export async function DELETE(request: Request, route: RouteContext<"/api/v1/documents/[id]">) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required."); if (!canWriteWorkspace(context) || !isManagementRole(context.role)) return problem(403, "forbidden", "Only practice managers can remove documents."); const { id } = await route.params;
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const result = await withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [document] = await tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.id, id), eq(organisationDocuments.organisationId, context.organisationId), isNull(organisationDocuments.deletedAt))).for("update").limit(1);
    if (!document) return null;
    if (document.legalHold) return { held: true as const };
    await tx.update(organisationDocuments).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(organisationDocuments.id, id), eq(organisationDocuments.organisationId, context.organisationId)));
    await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "document.archived", resourceType: "organisation_document", resourceId: id, metadata: { checksum: document.checksum, retainedObject: true, retentionUntil: document.retentionUntil } }));
    return { held: false as const };
  });
  if (!result) return problem(404, "document_not_found", "The document could not be found.");
  if (result.held) return problem(409, "legal_hold", "This document is under legal hold and cannot be archived.");
  // Archiving must not erase a retained original. Physical removal needs a separate retention/legal-hold review.
  return new Response(null, { status: 204 });
}

/** Recovery restores the retained original; it does not create another upload. */
export async function POST(request: Request, route: RouteContext<"/api/v1/documents/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication is required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (!canWriteWorkspace(context) || !isManagementRole(context.role)) return problem(403, "forbidden", "Practice management access is required to restore documents.");
  const parsed = await parseBody(request, z.object({ action: z.literal("restore"), expectedChecksum: z.string().min(1) }));
  if (!parsed.success) return problem(400, "invalid_request", "Choose an archived document to restore.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success || context.demo) return problem(404, "document_not_found", "The document could not be found.");
  return withTenant(createDatabase(), context.organisationId, async tx => {
    const [document] = await tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.id, id), eq(organisationDocuments.organisationId, context.organisationId), isNotNull(organisationDocuments.deletedAt), documentAccess(context.role, context.internalUserId))).for("update").limit(1);
    if (!document) return problem(404, "document_not_found", "The archived document could not be found.");
    if (document.purgeStatus !== "retained") return problem(409,"removal_pending","This original is pending removal or has been removed. It cannot be restored.");
    if (document.checksum !== parsed.data.expectedChecksum) return problem(409, "document_changed", "Reload the document archive before restoring it.");
    const [restored] = await tx.update(organisationDocuments).set({ deletedAt: null, updatedAt: new Date() }).where(and(eq(organisationDocuments.id, id), eq(organisationDocuments.organisationId, context.organisationId))).returning();
    await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "document.restored", resourceType: "organisation_document", resourceId: id, metadata: { checksum: document.checksum, archivedAt: document.deletedAt, retainedOriginal: true } }));
    return ok({ id: restored.id, name: restored.name, checksum: restored.checksum });
  });
}
