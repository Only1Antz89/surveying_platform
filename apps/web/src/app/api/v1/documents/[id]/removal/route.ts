import { ownsDocumentOriginal } from "@/lib/document-original-verification";
import { z } from "zod";
import { and,eq } from "drizzle-orm";
import { auditEvents,backgroundJobs,createDatabase,organisationDocuments,reportDeliveries,withTenant } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { apiContext,canWriteWorkspace } from "@/lib/access";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { ok,parseBody,problem } from "@/lib/api";
const input=z.object({expectedChecksum:z.string().min(1),expectedUpdatedAt:z.iso.datetime(),reason:z.string().trim().min(10).max(2000),confirmed:z.literal(true)}).strict();
export async function POST(request:Request,route:RouteContext<"/api/v1/documents/[id]/removal">) {
  const context=await apiContext(request);if(!context)return problem(401,"unauthorised","Sign in to review removal.");
  const denial=await workspaceApiGuard(request,context);if(denial)return denial;
  if(!canWriteWorkspace(context)||!isManagementRole(context.role))return problem(403,"forbidden","Practice management access is required.");
  if(context.demo)return problem(409,"preview_only","Sign in to request removal.");
  const parsed=await parseBody(request,input);if(!parsed.success)return problem(400,"invalid_request","Review the original, record a reason and confirm permanent removal.");
  const {id}=await route.params;if(!z.uuid().safeParse(id).success)return problem(404,"document_not_found","Document not found.");
  return withTenant(createDatabase(),context.organisationId,async tx=>{
    const [document]=await tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.id,id),eq(organisationDocuments.organisationId,context.organisationId))).for("update");
    if(!document)return problem(404,"document_not_found","Document not found.");
    if(document.purgeStatus!=="retained"||document.checksum!==parsed.data.expectedChecksum||document.updatedAt.toISOString()!==parsed.data.expectedUpdatedAt)return problem(409,"document_changed","Reload and review the current removal state.");
    if(!document.deletedAt||document.legalHold||!document.retentionUntil||document.retentionUntil>new Date())return problem(409,"document_protected","Removal requires an archived original, expired retention and no legal hold.");
    const [reportReference]=await tx.select({id:reportDeliveries.id}).from(reportDeliveries).where(eq(reportDeliveries.documentId,id)).limit(1);
    if(reportReference||document.jobId||document.reportVersionId||!ownsDocumentOriginal(document.blobPathname,document.organisationId,document.id))return problem(409,"document_protected","Report-linked and built-in demo originals require their own retention workflow.");
    const now=new Date();
    await tx.update(organisationDocuments).set({purgeStatus:"pending",purgeRequestedAt:now,updatedAt:now}).where(eq(organisationDocuments.id,id));
    const [job]=await tx.insert(backgroundJobs).values({organisationId:context.organisationId,queue:"document_removal",type:"remove_retained_original",deduplicationKey:`document-removal:${id}`,payload:{documentId:id,checksum:document.checksum,blobPathname:document.blobPathname}}).returning();
    await tx.insert(auditEvents).values({organisationId:context.organisationId,actorUserId:context.internalUserId,action:"document.removal_requested",resourceType:"organisation_document",resourceId:id,metadata:{reason:parsed.data.reason,confirmed:true,checksum:document.checksum,retentionUntil:document.retentionUntil,jobId:job.id}});
    return ok({id,purgeStatus:"pending",jobId:job.id,removed:false});
  });
}

/** Cancellation is permitted only before a worker commits its storage boundary. */
export async function PATCH(request:Request,route:RouteContext<"/api/v1/documents/[id]/removal">) {
  const context=await apiContext(request);if(!context)return problem(401,"unauthorised","Sign in to cancel removal.");
  const denial=await workspaceApiGuard(request,context);if(denial)return denial;
  if(!canWriteWorkspace(context)||!isManagementRole(context.role))return problem(403,"forbidden","Practice management access is required.");
  if(context.demo)return problem(409,"preview_only","Sign in to cancel removal.");
  const parsed=await parseBody(request,input);if(!parsed.success)return problem(400,"invalid_request","Review the pending request and confirm cancellation.");
  const {id}=await route.params;if(!z.uuid().safeParse(id).success)return problem(404,"document_not_found","Document not found.");
  return withTenant(createDatabase(),context.organisationId,async tx=>{
    // Match the worker's job-then-document lock order.
    const [job]=await tx.select().from(backgroundJobs).where(and(eq(backgroundJobs.organisationId,context.organisationId),eq(backgroundJobs.queue,"document_removal"),eq(backgroundJobs.deduplicationKey,`document-removal:${id}`))).for("update");
    const [document]=await tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.id,id),eq(organisationDocuments.organisationId,context.organisationId))).for("update");
    if(!document)return problem(404,"document_not_found","Document not found.");
    if(!job||job.status!=="queued"||job.payload.documentId!==id||document.purgeStatus!=="pending")return problem(409,"removal_started","Removal is no longer pending. Storage evidence must be reviewed before recovery.");
    if(document.checksum!==parsed.data.expectedChecksum||document.updatedAt.toISOString()!==parsed.data.expectedUpdatedAt)return problem(409,"document_changed","Reload and review the pending request.");
    const now=new Date();
    await tx.update(backgroundJobs).set({status:"cancelled",deduplicationKey:null,lockedUntil:null,updatedAt:now}).where(eq(backgroundJobs.id,job.id));
    await tx.update(organisationDocuments).set({purgeStatus:"retained",purgeRequestedAt:null,updatedAt:now}).where(eq(organisationDocuments.id,id));
    await tx.insert(auditEvents).values({organisationId:context.organisationId,actorUserId:context.internalUserId,action:"document.removal_cancelled",resourceType:"organisation_document",resourceId:id,metadata:{jobId:job.id,reason:parsed.data.reason,confirmed:true,checksum:document.checksum}});
    return ok({id,purgeStatus:"retained",updatedAt:now,removed:false});
  });
}
