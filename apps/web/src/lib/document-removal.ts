import { boundedStorageOperation,ownsDocumentOriginal,verifyDocumentOriginal } from "./document-original-verification";
import { z } from "zod";
import { and,asc,eq,inArray,isNull,lte,or } from "drizzle-orm";
import { auditEvents,backgroundJobs,createDatabase,organisationDocuments,reportDeliveries,type Database } from "@surveynt/db";
import { getObjectStorage,type ObjectStorage } from "./storage";

// Storage deletion happens only after the durable removing state commits.
// An interrupted attempt is reconciled by reading storage, never by blind deletion.
async function finish(db:Database,jobId:string,token:string,documentId:string,organisationId:string,outcome:"purged"|"verification_required",error:string|null) {
  return db.transaction(async tx=>{
    const [job]=await tx.select().from(backgroundJobs).where(and(eq(backgroundJobs.id,jobId),eq(backgroundJobs.leaseToken,token),inArray(backgroundJobs.status,["sending","processing"]))).for("update");
    if(!job)return false;
    const [document]=await tx.update(organisationDocuments).set({purgeStatus:outcome,purgedAt:outcome==="purged"?new Date():null,updatedAt:new Date()}).where(and(eq(organisationDocuments.id,documentId),eq(organisationDocuments.organisationId,organisationId),inArray(organisationDocuments.purgeStatus,["removing","verification_required"]))).returning();
    if(!document)return false;
    await tx.update(backgroundJobs).set({status:outcome==="purged"?"completed":"verification_required",error,lockedUntil:null,completedAt:outcome==="purged"?new Date():null,updatedAt:new Date()}).where(eq(backgroundJobs.id,jobId));
    await tx.insert(auditEvents).values({organisationId,action:outcome==="purged"?"document.original_removed":"document.removal_verification_required",resourceType:"organisation_document",resourceId:documentId,metadata:{jobId,attemptId:token,checksum:document.checksum,error}});
    return true;
  });
}

export async function processDocumentRemovalQueue(limit=10, supplied?:{db:Database;storage:ObjectStorage}) {
  if(!supplied&&!process.env.DATABASE_ADMIN_URL)throw new Error("DATABASE_ADMIN_URL is required.");
  const db=supplied?.db??createDatabase(process.env.DATABASE_ADMIN_URL!);
  const storage=supplied?.storage??getObjectStorage();if(!storage)return {configured:false,removed:0,review:0};
  const started=Date.now();let removed=0,review=0;
  const jobs=await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.queue,"document_removal"),or(eq(backgroundJobs.status,"queued"),and(eq(backgroundJobs.status,"sending"),or(isNull(backgroundJobs.lockedUntil),lte(backgroundJobs.lockedUntil,new Date())))),lte(backgroundJobs.availableAt,new Date()))).orderBy(asc(backgroundJobs.availableAt),asc(backgroundJobs.id)).limit(Number.isFinite(limit)?Math.max(1,Math.min(Math.floor(limit),20)):10);
  for(const candidate of jobs){
    if(Date.now()-started>35000)break;
    if(candidate.status==="sending"&&candidate.lockedUntil&&candidate.lockedUntil>new Date())continue;
    if(!candidate.organisationId||!z.uuid().safeParse(candidate.payload.documentId).success){
      await db.update(backgroundJobs).set({status:"verification_required",error:"Removal job has no valid practice/document binding.",lockedUntil:null,updatedAt:new Date()}).where(and(eq(backgroundJobs.id,candidate.id),eq(backgroundJobs.status,candidate.status)));
      review++;continue;
    }
    const token=crypto.randomUUID();
    const claim=await db.transaction(async tx=>{
      const [job]=await tx.select().from(backgroundJobs).where(eq(backgroundJobs.id,candidate.id)).for("update");
      if(!job||!["queued","sending"].includes(job.status)||(job.status==="sending"&&job.lockedUntil&&job.lockedUntil>new Date()))return null;
      const [document]=await tx.select().from(organisationDocuments).where(and(eq(organisationDocuments.id,String(job.payload.documentId)),eq(organisationDocuments.organisationId,job.organisationId!))).for("update");
      const [reportReference]=document?await tx.select({id:reportDeliveries.id}).from(reportDeliveries).where(eq(reportDeliveries.documentId,document.id)).limit(1):[];
      if(reportReference||job.type!=="remove_retained_original"||!document||document.checksum!==job.payload.checksum||document.blobPathname!==job.payload.blobPathname||!document.deletedAt||document.legalHold||!document.retentionUntil||document.retentionUntil>new Date()||document.jobId||document.reportVersionId||!ownsDocumentOriginal(document.blobPathname,document.organisationId,document.id)||!((job.status==="queued"&&document.purgeStatus==="pending")||(job.status==="sending"&&document.purgeStatus==="removing"))){
        const error="Original binding or protection requires review.";
        await tx.update(backgroundJobs).set({status:"verification_required",error,lockedUntil:null,updatedAt:new Date()}).where(eq(backgroundJobs.id,job.id));
        if(document&&["pending","removing"].includes(document.purgeStatus)) {
          await tx.update(organisationDocuments).set({purgeStatus:"verification_required",updatedAt:new Date()}).where(eq(organisationDocuments.id,document.id));
          await tx.insert(auditEvents).values({organisationId:document.organisationId,action:"document.removal_verification_required",resourceType:"organisation_document",resourceId:document.id,metadata:{jobId:job.id,error,checksum:document.checksum}});
        }
        return {held:true as const};
      }
      await tx.update(organisationDocuments).set({purgeStatus:"removing",updatedAt:new Date()}).where(eq(organisationDocuments.id,document.id));
      await tx.update(backgroundJobs).set({status:"sending",leaseToken:token,attempts:job.attempts+1,lockedUntil:new Date(Date.now()+300000),updatedAt:new Date()}).where(eq(backgroundJobs.id,job.id));
      return {job,document,recovery:job.status==="sending"};
    });
    if(!claim)continue;
    if("held" in claim){review++;continue;}
    const {job,document,recovery}=claim;
    try {
      const existing=await boundedStorageOperation(storage.get(document.blobPathname),object=>{if(object)void object.stream.cancel().catch(()=>undefined);});
      if(existing&&recovery)await existing.stream.cancel();
      if(recovery){
        const outcome=existing?"verification_required":"purged";
        if(await finish(db,job.id,token,document.id,document.organisationId,outcome,existing?"Interrupted removal: original still present; review before another attempt.":null)){if(existing)review++;else removed++;}
        continue;
      }
      if(!existing){await finish(db,job.id,token,document.id,document.organisationId,"verification_required","Original was already absent before deletion; investigate storage evidence.");review++;continue;}
      try {await verifyDocumentOriginal(existing.stream,document.sizeBytes,document.checksum);} catch(reason){await finish(db,job.id,token,document.id,document.organisationId,"verification_required",reason instanceof Error?reason.message:"Original verification failed.");review++;continue;}
      await boundedStorageOperation(storage.remove(document.blobPathname));
      const remaining=await boundedStorageOperation(storage.get(document.blobPathname),object=>{if(object)void object.stream.cancel().catch(()=>undefined);});
      if(remaining){await remaining.stream.cancel();throw new Error("Storage still contains the original after deletion.");}
      if(await finish(db,job.id,token,document.id,document.organisationId,"purged",null))removed++;
    }catch(reason){
      // Keep the durable sending/removing state for recovery after the lease expires.
      await db.update(backgroundJobs).set({error:reason instanceof Error?reason.message.slice(0,1000):"Removal result is unknown.",updatedAt:new Date()}).where(and(eq(backgroundJobs.id,job.id),eq(backgroundJobs.leaseToken,token),eq(backgroundJobs.status,"sending")));
    }
  }
  return {configured:true,removed,review};
}
