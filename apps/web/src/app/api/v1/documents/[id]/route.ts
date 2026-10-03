import { canManageTeam } from "@surveynt/domain";
import { and, eq, isNull } from "drizzle-orm";
import { auditEvents, createDatabase, organisationDocuments, withTenant } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { problem } from "@/lib/api";
import { getObjectStorage } from "@/lib/storage";

export async function GET(request: Request, route: RouteContext<"/api/v1/documents/[id]">) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required."); const { id } = await route.params;
  const [document] = context.demo ? [] : await withTenant(createDatabase(), context.organisationId, (tx) => tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.id, id), eq(organisationDocuments.organisationId, context.organisationId), isNull(organisationDocuments.deletedAt))).limit(1));
  const object = document ? await getObjectStorage()?.get(document.blobPathname) : null; if (!document || !object) return problem(404, "document_not_found", "The document could not be found.");
  return new Response(object.stream, { headers: { "content-type": document.contentType, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": `attachment; filename="${document.name.replace(/["\r\n]/g, "")}"` } });
}
export async function DELETE(request: Request, route: RouteContext<"/api/v1/documents/[id]">) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required."); if (!canWriteWorkspace(context) || !canManageTeam(context.role)) return problem(403, "forbidden", "Only owners and administrators can remove documents."); const { id } = await route.params;
  const result = await withTenant(createDatabase(), context.organisationId, async (tx) => { const [document] = await tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.id, id), eq(organisationDocuments.organisationId, context.organisationId), isNull(organisationDocuments.deletedAt))).limit(1); if (!document) return null; if (document.legalHold) return { held: true as const, document }; await tx.update(organisationDocuments).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(organisationDocuments.id, id)); await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "document.deleted", resourceType: "organisation_document", resourceId: id, metadata: { checksum: document.checksum } }); return { held: false as const, document }; });
  if (!result) return problem(404, "document_not_found", "The document could not be found."); if (result.held) return problem(409, "legal_hold", "This document is under legal hold and cannot be removed."); await getObjectStorage()?.remove(result.document.blobPathname).catch(() => undefined); return new Response(null, { status: 204 });
}
