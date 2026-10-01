import { and, asc, eq, inArray, lt, lte } from "drizzle-orm";
import { auditEvents, backgroundJobs, createDatabase, organisationMemberships, organisations, subscriptions, users } from "@surveynt/db";
import { applicationUrl, emailDeliveryConfigured, type EmailJobType, emailJobTypes, renderEmail, sendEmail } from "./email";

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

export async function processEmailQueue(limit = 20) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for email delivery.");
  if (!emailDeliveryConfigured()) return { configured: false, claimed: 0, completed: 0, retried: 0, failed: 0 };
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const now = new Date();
  const candidates = await db.select().from(backgroundJobs).where(and(
    eq(backgroundJobs.queue, "email"),
    eq(backgroundJobs.status, "queued"),
    lte(backgroundJobs.availableAt, now),
    lt(backgroundJobs.attempts, maximumAttempts),
  )).orderBy(asc(backgroundJobs.availableAt), asc(backgroundJobs.createdAt)).limit(Math.max(1, Math.min(limit, 50)) * 2);
  let claimed = 0;
  let completed = 0;
  let retried = 0;
  let failed = 0;
  for (const candidate of candidates) {
    if (claimed >= limit) break;
    const [job] = await db.update(backgroundJobs).set({ status: "processing", attempts: candidate.attempts + 1, error: null, updatedAt: new Date() }).where(and(eq(backgroundJobs.id, candidate.id), eq(backgroundJobs.status, "queued"))).returning();
    if (!job) continue;
    claimed += 1;
    try {
      if (!emailJobTypes.includes(job.type as EmailJobType)) throw new Error(`Unsupported email job type: ${job.type}`);
      const message = renderEmail(job.type as EmailJobType, job.payload);
      const delivery = await sendEmail(message);
      await db.update(backgroundJobs).set({ status: "completed", completedAt: new Date(), failedAt: null, error: null, providerMessageId: delivery.providerMessageId, updatedAt: new Date() }).where(eq(backgroundJobs.id, job.id));
      await db.insert(auditEvents).values({ organisationId: job.organisationId, action: "notification.email_accepted", resourceType: "background_job", resourceId: job.id, metadata: { type: job.type, providerMessageId: delivery.providerMessageId } });
      completed += 1;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message.slice(0, 1000) : "Unknown email delivery error";
      const exhausted = job.attempts >= maximumAttempts;
      const retryDelayMinutes = Math.min(2 ** job.attempts, 60);
      await db.update(backgroundJobs).set(exhausted
        ? { status: "failed", failedAt: new Date(), error: message, updatedAt: new Date() }
        : { status: "queued", availableAt: new Date(Date.now() + retryDelayMinutes * 60 * 1000), error: message, updatedAt: new Date() }
      ).where(eq(backgroundJobs.id, job.id));
      if (exhausted) {
        failed += 1;
        await db.insert(auditEvents).values({ organisationId: job.organisationId, action: "notification.email_failed", resourceType: "background_job", resourceId: job.id, metadata: { type: job.type, attempts: job.attempts, error: message } });
      } else retried += 1;
    }
  }
  return { configured: true, claimed, completed, retried, failed };
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
