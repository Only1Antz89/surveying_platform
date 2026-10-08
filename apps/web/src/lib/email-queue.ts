import { and, asc, eq, inArray, lt, lte, or, isNull, sql } from "drizzle-orm";
import { auditEvents, backgroundJobs, communicationDeliveries, createDatabase, type Database, organisationMemberships, organisationOperationalSettings, organisations, subscriptions, users } from "@surveynt/db";
import { applicationUrl, EmailDeliveryError, emailDeliveryConfigured, type EmailJobType, emailJobTypes, renderEmail, sendEmail } from "./email";
import { shouldSendNotification } from "./notification-preferences";
import { isDemoOrganisation } from "./stakeholder-demo";

const maximumAttempts = 5;
const dayMs = 24 * 60 * 60 * 1000;

export function trialDaysRemaining(trialEndsAt: Date, now = new Date()) {
  const trialDay = Date.UTC(trialEndsAt.getUTCFullYear(), trialEndsAt.getUTCMonth(), trialEndsAt.getUTCDate());
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((trialDay - currentDay) / dayMs);
}

export async function enqueueEmail(input: { organisationId: string; type: EmailJobType; deduplicationKey: string; payload: Record<string, unknown> }) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for email queueing.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [created] = await db.insert(backgroundJobs).values({ organisationId: input.organisationId, queue: "email", type: input.type, deduplicationKey: input.deduplicationKey, payload: input.payload }).onConflictDoNothing().returning({ id: backgroundJobs.id });
  return Boolean(created);
}

export async function enqueueDailyNotifications(now = new Date()) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for scheduled notifications.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const trialRows = await db.select({
    subscriptionId: subscriptions.id,
    organisationId: organisations.id,
    organisationName: organisations.name,
    slug: organisations.slug,
    trialEndsAt: subscriptions.trialEndsAt,
  }).from(subscriptions).innerJoin(organisations, eq(subscriptions.organisationId, organisations.id)).where(and(eq(subscriptions.status, "trialing"), eq(organisations.status, "active")));
  if (!trialRows.length) return { eligible: 0, queued: 0 };
  const organisationIds = trialRows.map((row) => row.organisationId);
  const ownerRows = await db.select({ organisationId: organisationMemberships.organisationId, email: users.email }).from(organisationMemberships).innerJoin(users, eq(organisationMemberships.userId, users.id)).where(and(inArray(organisationMemberships.organisationId, organisationIds), eq(organisationMemberships.role, "owner"), eq(organisationMemberships.active, true)));
  let eligible = 0;
  let queued = 0;
  for (const trial of trialRows) {
    if (!trial.trialEndsAt) continue;
    const daysRemaining = trialDaysRemaining(trial.trialEndsAt, now);
    if (daysRemaining !== 7 && daysRemaining !== 3 && daysRemaining !== 1) continue;
    const recipients = [...new Set(ownerRows.filter((owner) => owner.organisationId === trial.organisationId).map((owner) => owner.email))];
    if (!recipients.length) continue;
    eligible += 1;
    const [job] = await db.insert(backgroundJobs).values({
      organisationId: trial.organisationId,
      queue: "email",
      type: "trial_ending_notice",
      deduplicationKey: `trial-ending:${trial.subscriptionId}:${daysRemaining}`,
      payload: { recipients, organisationName: trial.organisationName, daysRemaining, trialEndsAt: trial.trialEndsAt.toISOString(), billingUrl: `${applicationUrl()}/app/${trial.slug}/settings/billing` },
    }).onConflictDoNothing().returning({ id: backgroundJobs.id });
    if (!job) continue;
    queued += 1;
    await db.insert(auditEvents).values({ organisationId: trial.organisationId, action: "notification.trial_ending_queued", resourceType: "subscription", resourceId: trial.subscriptionId, metadata: { daysRemaining, jobId: job.id } });
  }
  return { eligible, queued };
}

const leaseMs = 5 * 60 * 1000;

async function updateDelivery(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], job: typeof backgroundJobs.$inferSelect, status: string, error: string | null, providerMessageId?: string | null) {
  if (typeof job.payload.deliveryId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.payload.deliveryId) || !job.organisationId) return;
  await tx.update(communicationDeliveries).set({ status, attempts: job.attempts, lastError: error,
    ...(status === "sent" ? { providerMessageId, sentAt: new Date() } : {}), updatedAt: new Date(),
  }).where(and(eq(communicationDeliveries.id,job.payload.deliveryId),eq(communicationDeliveries.organisationId,job.organisationId)));
}

export async function completeEmailDelivery(db: Database, jobId: string, leaseToken: string, providerMessageId: string | null) {
  return db.transaction(async tx => {
    const [job] = await tx.update(backgroundJobs).set({status:"completed",completedAt:new Date(),failedAt:null,error:null,providerMessageId,lockedUntil:null,updatedAt:new Date()}).where(and(eq(backgroundJobs.id,jobId),eq(backgroundJobs.queue,"email"),eq(backgroundJobs.leaseToken,leaseToken),inArray(backgroundJobs.status,["sending","delivery_unknown"]))).returning();
    if (!job) return false;
    await updateDelivery(tx,job,"sent",null,providerMessageId);
    await tx.insert(auditEvents).values({organisationId:job.organisationId,action:"notification.email_accepted",resourceType:"background_job",resourceId:job.id,metadata:{type:job.type,providerMessageId,attemptId:leaseToken}});
    return true;
  });
}

export async function recoverEmailLeases(db: Database) {
  return db.transaction(async tx => {
    const clock = await tx.execute(sql`select clock_timestamp()::text as "now"`);
    const now = new Date(clock.rows[0].now as string);
    const rows = await tx.select().from(backgroundJobs).where(and(eq(backgroundJobs.queue,"email"),inArray(backgroundJobs.status,["processing","sending"]),or(lte(backgroundJobs.lockedUntil,now),and(isNull(backgroundJobs.lockedUntil),lte(backgroundJobs.updatedAt,new Date(now.getTime()-leaseMs)))))).for("update",{skipLocked:true}).limit(100);
    for (const job of rows) {
      // Older workers had no attempt token and may already have sent the message.
      const uncertain = job.status === "sending" || !job.leaseToken;
      const exhausted = job.attempts >= maximumAttempts;
      const status = uncertain ? "delivery_unknown" : exhausted ? "failed" : "queued";
      const error = uncertain ? "Worker interrupted after possible dispatch. Verify provider evidence before resending." : "Worker interrupted before dispatch.";
      await tx.update(backgroundJobs).set({status,error,lockedUntil:null,availableAt:now,failedAt:status==="queued"?null:now,updatedAt:now}).where(eq(backgroundJobs.id,job.id));
      await updateDelivery(tx,job,uncertain?"verification_required":exhausted?"failed":"retrying",error);
      await tx.insert(auditEvents).values({organisationId:job.organisationId,action:uncertain?"notification.email_verification_required":"notification.email_lease_recovered",resourceType:"background_job",resourceId:job.id,metadata:{previousStatus:job.status,attemptId:job.leaseToken,status}});
    }
    return rows.length;
  });
}

export async function processEmailQueue(limit = 20) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for email delivery.");
  if (!emailDeliveryConfigured()) return {configured:false,claimed:0,completed:0,retried:0,failed:0,verificationRequired:0,recovered:0,suppressed:0};
  const startedAt = Date.now();
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const recovered = await recoverEmailLeases(db);
  const bound = Number.isFinite(limit) ? Math.max(1,Math.min(Math.floor(limit),50)) : 20;
  const candidates = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.queue,"email"),eq(backgroundJobs.status,"queued"),lte(backgroundJobs.availableAt,sql`clock_timestamp()`),lt(backgroundJobs.attempts,maximumAttempts))).orderBy(asc(backgroundJobs.availableAt),asc(backgroundJobs.createdAt)).limit(bound*2);
  let claimed=0,completed=0,retried=0,failed=0,verificationRequired=0,suppressed=0;
  for (const candidate of candidates) {
    if (claimed >= bound || Date.now()-startedAt > 40000) break;
    const token = crypto.randomUUID();
    const [job] = await db.update(backgroundJobs).set({status:"processing",attempts:candidate.attempts+1,leaseToken:token,lockedUntil:sql`clock_timestamp() + interval '5 minutes'`,error:null,updatedAt:sql`clock_timestamp()`}).where(and(eq(backgroundJobs.id,candidate.id),eq(backgroundJobs.status,"queued"),eq(backgroundJobs.attempts,candidate.attempts),lte(backgroundJobs.availableAt,sql`clock_timestamp()`))).returning();
    if (!job) continue;
    claimed++;
    let dispatched=false,accepted=false;
    try {
      if (!emailJobTypes.includes(job.type as EmailJobType)) throw new Error(`Unsupported email job type: ${job.type}`);
      const [settings] = job.organisationId ? await db.select({preferences:organisationOperationalSettings.notificationPreferences,templates:organisationOperationalSettings.emailTemplates}).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,job.organisationId)).limit(1) : [];
      if (!shouldSendNotification(job.type as EmailJobType, settings?.preferences)) {
        const skipped = await db.transaction(async tx => {
          const [current] = await tx.update(backgroundJobs).set({status:"completed",completedAt:new Date(),failedAt:null,lockedUntil:null,error:null,updatedAt:new Date()}).where(and(eq(backgroundJobs.id,job.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,token))).returning();
          if (!current) return false;
          await updateDelivery(tx,current,"suppressed",null);
          await tx.insert(auditEvents).values({organisationId:job.organisationId,action:"notification.email_suppressed",resourceType:"background_job",resourceId:job.id,metadata:{type:job.type,reason:"practice_notification_preference",attemptId:token}});
          return true;
        });
        if (skipped) suppressed++;
        continue;
      }
      const message=renderEmail(job.type as EmailJobType,job.payload,settings?.templates);
      const simulated=job.organisationId ? await isDemoOrganisation(job.organisationId,db) : false;
      const [sending]=await db.update(backgroundJobs).set({status:"sending",updatedAt:new Date()}).where(and(eq(backgroundJobs.id,job.id),eq(backgroundJobs.status,"processing"),eq(backgroundJobs.leaseToken,token))).returning({id:backgroundJobs.id});
      if (!sending) continue;
      dispatched=true;
      const delivery=simulated ? {providerMessageId:`demo_${job.id}`} : await sendEmail(message,fetch,{jobId:job.id,attemptId:token});
      accepted=true;
      if (await completeEmailDelivery(db,job.id,token,delivery.providerMessageId)) completed++;
    } catch (reason) {
      // A persistence failure after provider acceptance must never schedule another send.
      const uncertain=accepted || dispatched && !(reason instanceof EmailDeliveryError && reason.rejected);
      const exhausted=job.attempts >= maximumAttempts;
      const status=uncertain?"delivery_unknown":exhausted?"failed":"queued";
      const error=reason instanceof Error ? reason.message.slice(0,1000) : "Unknown delivery error";
      const changed=await db.transaction(async tx=>{
        const [current]=await tx.update(backgroundJobs).set({status,error,lockedUntil:null,failedAt:status==="queued"?null:new Date(),availableAt:new Date(Date.now()+Math.min(2**job.attempts,60)*60000),updatedAt:new Date()}).where(and(eq(backgroundJobs.id,job.id),eq(backgroundJobs.leaseToken,token),inArray(backgroundJobs.status,["processing","sending"]))).returning();
        if (!current) return false;
        await updateDelivery(tx,current,uncertain?"verification_required":exhausted?"failed":"retrying",error);
        if (status!=="queued") await tx.insert(auditEvents).values({organisationId:job.organisationId,action:uncertain?"notification.email_verification_required":"notification.email_failed",resourceType:"background_job",resourceId:job.id,metadata:{type:job.type,attempts:job.attempts,error,attemptId:token}});
        return true;
      });
      if (changed) { if(uncertain)verificationRequired++;else if(exhausted)failed++;else retried++; }
    }
  }
  return {configured:true,claimed,completed,retried,failed,verificationRequired,recovered,suppressed};
}

export async function queueSubscriptionEmail(input: {
  organisationId: string;
  subscriptionId: string;
  type: "trial_started_notice" | "payment_issue_notice";
  deduplicationKey: string;
  trialEndsAt?: Date | null;
  status?: "past_due" | "unpaid";
  graceEndsAt?: Date | null;
}) {
  if (!process.env.DATABASE_ADMIN_URL) return false;
  if (input.type === "trial_started_notice" && !input.trialEndsAt) return false;
  if (input.type === "payment_issue_notice" && !input.status) return false;
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [organisation, owners] = await Promise.all([
    db.select({ name: organisations.name, slug: organisations.slug }).from(organisations).where(eq(organisations.id, input.organisationId)).limit(1).then((rows) => rows[0]),
    db.select({ email: users.email }).from(organisationMemberships).innerJoin(users, eq(organisationMemberships.userId, users.id)).where(and(eq(organisationMemberships.organisationId, input.organisationId), eq(organisationMemberships.role, "owner"), eq(organisationMemberships.active, true))),
  ]);
  const recipients = [...new Set(owners.map((owner) => owner.email))];
  if (!organisation || !recipients.length) return false;
  const payload = input.type === "trial_started_notice"
    ? { recipients, organisationName: organisation.name, trialEndsAt: input.trialEndsAt?.toISOString(), workspaceUrl: `${applicationUrl()}/app/${organisation.slug}/overview` }
    : { recipients, organisationName: organisation.name, status: input.status, graceEndsAt: input.graceEndsAt?.toISOString() ?? null, billingUrl: `${applicationUrl()}/app/${organisation.slug}/settings/billing` };
  const [job] = await db.insert(backgroundJobs).values({ organisationId: input.organisationId, queue: "email", type: input.type, deduplicationKey: input.deduplicationKey, payload }).onConflictDoNothing().returning({ id: backgroundJobs.id });
  if (!job) return false;
  await db.insert(auditEvents).values({ organisationId: input.organisationId, action: `notification.${input.type.replace("_notice", "")}_queued`, resourceType: "subscription", resourceId: input.subscriptionId, metadata: { jobId: job.id } });
  return true;
}
