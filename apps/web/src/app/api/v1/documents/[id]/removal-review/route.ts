import { z } from "zod";
import { and,eq } from "drizzle-orm";
import { auditEvents,backgroundJobs,createDatabase,organisationDocuments,withTenant } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { apiContext,canWriteWorkspace } from "@/lib/access";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { ok,parseBody,problem } from "@/lib/api";
import { getObjectStorage } from "@/lib/storage";
import { boundedStorageOperation,ownsDocumentOriginal,verifyDocumentOriginal } from "@/lib/document-original-verification";

export const runtime="nodejs";
export const maxDuration=60;
const review=z.object({outcome:z.enum(["keep_original","confirm_absent"]),expectedChecksum:z.string().min(1),expectedUpdatedAt:z.iso.datetime(),expectedAttempts:z.number().int().nonnegative(),expectedLeaseToken:z.uuid().nullable(),evidence:z.string().trim().min(20).max(2000),providerOperationsSettled:z.literal(true),confirmed:z.literal(true)}).strict();
export async function POST(request:Request,route:RouteContext<"/api/v1/documents/[id]/removal-review">){
  const context=await apiContext(request);if(!context)return problem(401,"unauthorised","Sign in to review storage evidence.");
  const denial=await workspaceApiGuard(request,context);if(denial)return denial;
  if(!canWriteWorkspace(context)||!isManagementRole(context.role))return problem(403,"forbidden","Practice management access is required.");
  if(context.demo)return problem(409,"preview_only","Sign in to persist a review.");
  const parsed=await parseBody(request,review);if(!parsed.success)return problem(400,"invalid_request","Record storage evidence and confirm all provider operations have settled.");
  const {id}=await route.params;if(!z.uuid().safeParse(id).success)return problem(404,"document_not_found","Document not found.");
  const storage=getObjectStorage();if(!storage)return problem(503,"storage_unavailable","Private storage is not configured.");
  return withTenant(createDatabase(),context.organisationId,async tx=>{
    const [job]=await tx.select().from(backgroundJobs).where(and(eq(backgroundJobs.organisationId,context.organisationId),eq(backgroundJobs.queue,"document_removal"),eq(backgroundJobs.deduplicationKey,`document-removal:${id}`))).for("update");
    const [document]=await tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.id,id),eq(organisationDocuments.organisationId,context.organisationId))).for("update");
    if(!document)return problem(404,"document_not_found","Document not found.");
    if(!job||job.status!=="verification_required"||document.purgeStatus!=="verification_required"||job.attempts!==parsed.data.expectedAttempts||job.leaseToken!==parsed.data.expectedLeaseToken||document.checksum!==parsed.data.expectedChecksum||document.updatedAt.toISOString()!==parsed.data.expectedUpdatedAt)return problem(409,"review_changed","Reload the current storage incident before reviewing it.");
    if(job.payload.documentId!==id||job.payload.checksum!==document.checksum||job.payload.blobPathname!==document.blobPathname||!ownsDocumentOriginal(document.blobPathname,document.organisationId,id))return problem(409,"binding_changed","The original storage binding requires separate investigation.");
    try {
      const object=await boundedStorageOperation(storage.get(document.blobPathname),value=>{if(value)void value.stream.cancel().catch(()=>undefined);});
      if(parsed.data.outcome==="confirm_absent"){
        if(object){void object.stream.cancel().catch(()=>undefined);return problem(409,"original_present","The original is still present. Its absence cannot be confirmed.");}
      }else{
        if(!object)return problem(409,"original_missing","The original is missing; it cannot be retained or restored.");
        await verifyDocumentOriginal(object.stream,document.sizeBytes,document.checksum);
      }
    }catch{return problem(409,"storage_unverified","Storage could not verify the reviewed original. The incident remains open.");}
    const now=new Date(),absent=parsed.data.outcome==="confirm_absent";
    await tx.update(backgroundJobs).set({status:absent?"completed":"cancelled",deduplicationKey:absent?job.deduplicationKey:null,error:null,lockedUntil:null,completedAt:absent?now:null,updatedAt:now}).where(eq(backgroundJobs.id,job.id));
    await tx.update(organisationDocuments).set({purgeStatus:absent?"purged":"retained",purgedAt:absent?now:null,purgeRequestedAt:absent?document.purgeRequestedAt:null,updatedAt:now}).where(eq(organisationDocuments.id,id));
    await tx.insert(auditEvents).values({organisationId:context.organisationId,actorUserId:context.internalUserId,action:"document.removal_reviewed",resourceType:"organisation_document",resourceId:id,metadata:{jobId:job.id,attemptId:job.leaseToken,outcome:parsed.data.outcome,evidence:parsed.data.evidence,providerOperationsSettled:true,confirmed:true,checksum:document.checksum}});
    return ok({id,purgeStatus:absent?"purged":"retained",updatedAt:now});
  });
}
