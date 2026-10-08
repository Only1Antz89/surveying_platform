import {workspaceAudit} from "@/lib/workspace-audit";
import { z } from "zod";
import { and,eq } from "drizzle-orm";
import { auditEvents,createDatabase,organisationDocuments,withTenant } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { apiContext,canWriteWorkspace } from "@/lib/access";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { ok,parseBody,problem } from "@/lib/api";
const review=z.object({expectedChecksum:z.string().min(1),expectedUpdatedAt:z.iso.datetime(),expectedLegalHold:z.boolean(),expectedRetentionUntil:z.iso.datetime().nullable(),retentionUntil:z.iso.datetime().nullable(),legalHold:z.boolean(),reason:z.string().trim().min(10).max(2000),confirmed:z.literal(true)});
export async function PATCH(request:Request,route:RouteContext<"/api/v1/documents/[id]/retention">){
  const context=await apiContext(request);if(!context)return problem(401,"unauthorised","Sign in to review document retention.");
  const denial=await workspaceApiGuard(request,context);if(denial)return denial;
  if(!canWriteWorkspace(context)||!isManagementRole(context.role))return problem(403,"forbidden","Practice management access is required to review retention.");
  if(context.demo)return problem(409,"preview_only","Sign in to persist a retention review.");
  const parsed=await parseBody(request,review);if(!parsed.success)return problem(400,"invalid_request","Review the current document, record a reason and confirm the protection changes.");
  const {id}=await route.params;if(!z.uuid().safeParse(id).success)return problem(404,"document_not_found","Document not found.");
  return withTenant(createDatabase(),context.organisationId,async tx=>{
    const [document]=await tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.id,id),eq(organisationDocuments.organisationId,context.organisationId))).for("update").limit(1);
    if(!document)return problem(404,"document_not_found","Document not found.");
    if(document.purgeStatus!=="retained")return problem(409,"removal_pending","Removal has already been requested. Protection cannot be changed during removal.");
    if(document.checksum!==parsed.data.expectedChecksum||document.updatedAt.toISOString()!==parsed.data.expectedUpdatedAt||document.legalHold!==parsed.data.expectedLegalHold||(document.retentionUntil?.toISOString()??null)!==parsed.data.expectedRetentionUntil)return problem(409,"document_changed","The document or its protection changed. Reload and review it again.");
    const retentionUntil=parsed.data.retentionUntil?new Date(parsed.data.retentionUntil):null;
    const [updated]=await tx.update(organisationDocuments).set({retentionUntil,legalHold:parsed.data.legalHold,updatedAt:new Date()}).where(eq(organisationDocuments.id,id)).returning();
    await tx.insert(auditEvents).values(workspaceAudit(context,{organisationId:context.organisationId,actorUserId:context.internalUserId,action:"document.retention_reviewed",resourceType:"organisation_document",resourceId:id,metadata:{checksum:document.checksum,reason:parsed.data.reason,confirmed:true,archivedAt:document.deletedAt,previous:{retentionUntil:document.retentionUntil,legalHold:document.legalHold},next:{retentionUntil,legalHold:updated.legalHold}}}));
    return ok({id:updated.id,updatedAt:updated.updatedAt,retentionUntil:updated.retentionUntil,legalHold:updated.legalHold,retainedOriginal:true});
  });
}
