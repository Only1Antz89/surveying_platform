import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auditEvents, backgroundJobs, communicationDeliveries, createDatabase } from "@surveynt/db";
import { platformApiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";

export async function POST(_: Request, route: RouteContext<"/api/platform/background-jobs/[jobId]/retry">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "Platform staff authentication is required.");
  if (operator.role !== "super_admin" && operator.role !== "support") return problem(403, "forbidden", "Your platform role cannot retry failed operational work.");
  const { jobId } = await route.params;
  if (operator.demo) return ok({ id: jobId, status: "queued" }, { demo: true, persisted: false });
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  return db.transaction(async tx => {
    const [job] = await tx.select().from(backgroundJobs).where(and(eq(backgroundJobs.id,jobId),eq(backgroundJobs.queue,"email"))).for("update").limit(1);
    if (!job || job.status !== "failed") return problem(409,"job_not_retryable","This email delivery is no longer in a failed state.");
    // Legacy failures could follow a successful provider send and a failed database write.
    if (!job.leaseToken || job.providerMessageId) {
      await tx.update(backgroundJobs).set({status:"delivery_unknown",error:"Legacy delivery acceptance requires provider verification before a retry.",lockedUntil:null,updatedAt:new Date()}).where(eq(backgroundJobs.id,jobId));
      if (typeof job.payload.deliveryId === "string" && z.uuid().safeParse(job.payload.deliveryId).success && job.organisationId) await tx.update(communicationDeliveries).set({status:"verification_required",lastError:"Legacy delivery acceptance requires provider verification.",updatedAt:new Date()}).where(and(eq(communicationDeliveries.id,job.payload.deliveryId),eq(communicationDeliveries.organisationId,job.organisationId)));
      await tx.insert(auditEvents).values({organisationId:job.organisationId,platformStaffId:operator.platformStaffId,action:"notification.email_verification_required",resourceType:"background_job",resourceId:jobId,metadata:{legacyFailure:true}});
      return ok({id:jobId,status:"delivery_unknown"},{verificationRequired:true});
    }
    await tx.update(backgroundJobs).set({status:"queued",attempts:0,availableAt:new Date(),failedAt:null,completedAt:null,error:null,lockedUntil:null,leaseToken:null,updatedAt:new Date()}).where(eq(backgroundJobs.id,jobId));
    if (typeof job.payload.deliveryId === "string" && z.uuid().safeParse(job.payload.deliveryId).success && job.organisationId) await tx.update(communicationDeliveries).set({status:"queued",attempts:0,lastError:null,updatedAt:new Date()}).where(and(eq(communicationDeliveries.id,job.payload.deliveryId),eq(communicationDeliveries.organisationId,job.organisationId)));
    await tx.insert(auditEvents).values({organisationId:job.organisationId,platformStaffId:operator.platformStaffId,action:"notification.email_retry_queued",resourceType:"background_job",resourceId:jobId,metadata:{type:job.type}});
    return ok({id:jobId,status:"queued"});
  });
}
