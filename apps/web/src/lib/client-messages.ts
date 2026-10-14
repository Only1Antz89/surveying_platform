import "server-only";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { appointments, auditEvents, clientMessages, clients, createDatabase, jobStageEvents, jobs, messageTemplates, organisationOperationalSettings, organisations, properties, users, withTenant, type TenantTransaction } from "@surveynt/db";
import { canMutateOperations, isManagementRole, type OrganisationRole } from "@surveynt/domain";
import { workspaceAudit } from "./workspace-audit";
import { assignedJobScope } from "./workspace-scope";
import { enqueueEmail } from "./email-queue";
import { defaultTemplates, fillTemplate, messageKeys, type MessageChannel, type MessageKey, type MessageValues } from "./client-messages-model";

type Context = { organisationId: string; internalUserId: string | null; role: OrganisationRole; actorRole?: OrganisationRole; workspaceMode?: import("./workspace-mode").WorkspaceMode };
export class MessageError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export type TemplateView = { key: MessageKey; channel: MessageChannel; subject: string | null; body: string; enabled: boolean; customised: boolean };
/** No text-message provider is connected yet; SMS templates can be prepared but never send. */
export const smsProviderConnected = () => false;

async function savedTemplates(tx: TenantTransaction, organisationId: string) {
  return tx.select().from(messageTemplates).where(eq(messageTemplates.organisationId, organisationId));
}
function merged(saved: (typeof messageTemplates.$inferSelect)[]): TemplateView[] {
  return messageKeys.flatMap((key) => (["email", "sms"] as const).map((channel) => {
    const row = saved.find((item) => item.key === key && item.channel === channel);
    return row ? { key, channel, subject: row.subject, body: row.body, enabled: row.enabled, customised: true } : { key, channel, subject: channel === "email" ? defaultTemplates[key].subject : null, body: channel === "email" ? defaultTemplates[key].body : defaultTemplates[key].sms, enabled: false, customised: false };
  }));
}

export async function listTemplates(context: Context) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [settings] = await tx.select({ reviewRequests: organisationOperationalSettings.reviewRequests }).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, context.organisationId)).limit(1);
    return { templates: merged(await savedTemplates(tx, context.organisationId)), reviewRequests: settings?.reviewRequests ?? { enabled: false, reviewUrl: null, delayDays: 2 }, smsConnected: smsProviderConnected() };
  });
}

export async function saveTemplate(context: Context, input: { key: MessageKey; channel: MessageChannel; subject?: string | null; body: string; enabled: boolean }) {
  if (!isManagementRole(context.role)) throw new MessageError(403, "forbidden", "Practice management access is required.");
  if (input.channel === "sms" && input.enabled && !smsProviderConnected()) throw new MessageError(409, "sms_not_connected", "Connect a text message provider before switching on text messages. You can save the wording now.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [row] = await tx.insert(messageTemplates).values({ organisationId: context.organisationId, key: input.key, channel: input.channel, subject: input.channel === "email" ? input.subject ?? null : null, body: input.body, enabled: input.enabled })
      .onConflictDoUpdate({ target: [messageTemplates.organisationId, messageTemplates.key, messageTemplates.channel], set: { subject: input.channel === "email" ? input.subject ?? null : null, body: input.body, enabled: input.enabled, version: sql`${messageTemplates.version} + 1`, updatedAt: new Date() } }).returning();
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "client_message.template_saved", resourceType: "message_template", resourceId: context.organisationId, metadata: { key: input.key, channel: input.channel, enabled: input.enabled } }));
    return { key: row.key as MessageKey, channel: row.channel as MessageChannel, subject: row.subject, body: row.body, enabled: row.enabled, customised: true } satisfies TemplateView;
  });
}

export async function saveReviewSettings(context: Context, value: { enabled: boolean; reviewUrl: string | null; delayDays: number }) {
  if (!isManagementRole(context.role)) throw new MessageError(403, "forbidden", "Practice management access is required.");
  if (value.enabled && !value.reviewUrl) throw new MessageError(422, "review_url_required", "Add the link where clients leave a review.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    await tx.insert(organisationOperationalSettings).values({ organisationId: context.organisationId, reviewRequests: value }).onConflictDoUpdate({ target: organisationOperationalSettings.organisationId, set: { reviewRequests: value, updatedAt: new Date() } });
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "client_message.review_settings_saved", resourceType: "organisation", resourceId: context.organisationId, metadata: { enabled: value.enabled, delayDays: value.delayDays } }));
    return value;
  });
}

type JobFacts = { jobId: string; reference: string; clientName: string; clientEmail: string | null; propertyAddress: string; surveyorName: string | null; organisationName: string; slug: string };
async function jobFacts(tx: TenantTransaction, organisationId: string, jobIds: string[]): Promise<JobFacts[]> {
  if (!jobIds.length) return [];
  const rows = await tx.select({ jobId: jobs.id, reference: jobs.reference, clientName: clients.displayName, clientEmail: clients.email, line1: properties.line1, city: properties.city, postcode: properties.postcode, firstName: users.firstName, lastName: users.lastName, organisationName: organisations.name, slug: organisations.slug })
    .from(jobs).innerJoin(clients, and(eq(clients.id, jobs.clientId), eq(clients.organisationId, jobs.organisationId))).innerJoin(properties, and(eq(properties.id, jobs.propertyId), eq(properties.organisationId, jobs.organisationId)))
    .innerJoin(organisations, eq(organisations.id, jobs.organisationId)).leftJoin(users, eq(users.id, jobs.assignedSurveyorId))
    .where(and(eq(jobs.organisationId, organisationId), inArray(jobs.id, jobIds)));
  return rows.map((row) => ({ jobId: row.jobId, reference: row.reference, clientName: row.clientName, clientEmail: row.clientEmail, propertyAddress: [row.line1, row.city, row.postcode].filter(Boolean).join(", "), surveyorName: [row.firstName, row.lastName].filter(Boolean).join(" ") || "Your surveyor", organisationName: row.organisationName, slug: row.slug }));
}

/** Queues one message (or records why it was skipped). Deduplicated by key, so retries never send twice. */
async function deliver(tx: TenantTransaction, input: { organisationId: string; facts: JobFacts; key: MessageKey; values: MessageValues; dedupKey: string; actorUserId: string | null }) {
  const saved = (await savedTemplates(tx, input.organisationId)).filter((row) => row.key === input.key);
  const email = saved.find((row) => row.channel === "email"), sms = saved.find((row) => row.channel === "sms");
  const values: MessageValues = { clientName: input.facts.clientName, practiceName: input.facts.organisationName, reference: input.facts.reference, propertyAddress: input.facts.propertyAddress, surveyorName: input.facts.surveyorName ?? "Your surveyor", ...input.values };
  const results: { channel: MessageChannel; status: "queued" | "skipped"; reason: string | null }[] = [];
  const record = async (channel: MessageChannel, status: "queued" | "skipped", reason: string | null, recipient: string | null) => {
    const [row] = await tx.insert(clientMessages).values({ organisationId: input.organisationId, jobId: input.facts.jobId, templateKey: input.key, channel, recipient, status, reason, dedupKey: `${input.dedupKey}:${channel}`, createdByUserId: input.actorUserId }).onConflictDoNothing().returning({ id: clientMessages.id });
    if (row) results.push({ channel, status, reason });
    return Boolean(row);
  };
  if (email?.enabled) {
    if (!input.facts.clientEmail) await record("email", "skipped", "The client has no email address.", null);
    else if (await record("email", "queued", null, input.facts.clientEmail)) {
      await enqueueEmail({ organisationId: input.organisationId, type: "client_message", deduplicationKey: `client-message:${input.dedupKey}`, payload: { recipients: [input.facts.clientEmail], organisationName: input.facts.organisationName, subject: fillTemplate(email.subject ?? defaultTemplates[input.key].subject, values), body: fillTemplate(email.body, values), ...(input.key === "review_request" && values.reviewLink ? { actionLabel: "Leave a review", actionUrl: values.reviewLink } : {}) } });
    }
  }
  if (sms?.enabled) await record("sms", "skipped", "No text message provider is connected.", null);
  return results;
}

/** Manual messages from the job record (on the way, access request). */
export async function sendJobMessage(context: Context, jobId: string, key: "on_the_way" | "access_request") {
  if (!canMutateOperations(context.role)) throw new MessageError(403, "forbidden", "Your role cannot message clients.");
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId), assignedJobScope(context))).limit(1);
    if (!job) throw new MessageError(404, "not_found", "The job could not be found.");
    const enabled = (await savedTemplates(tx, context.organisationId)).some((row) => row.key === key && row.enabled);
    if (!enabled) throw new MessageError(409, "template_off", "Switch this message on in Client messages first.");
    const [facts] = await jobFacts(tx, context.organisationId, [jobId]);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    const results = await deliver(tx, { organisationId: context.organisationId, facts, key, values: {}, dedupKey: `${key}:${jobId}:${day}`, actorUserId: context.internalUserId });
    if (!results.length) throw new MessageError(409, "already_sent", "This message was already sent today.");
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "client_message.sent", resourceType: "job", resourceId: jobId, metadata: { key, results } }));
    return results;
  });
}

export async function jobMessageLog(context: Context, jobId: string) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [job] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId), assignedJobScope(context))).limit(1);
    if (!job) return null;
    const [log, saved] = await Promise.all([
      tx.select({ templateKey: clientMessages.templateKey, channel: clientMessages.channel, status: clientMessages.status, reason: clientMessages.reason, createdAt: clientMessages.createdAt }).from(clientMessages).where(and(eq(clientMessages.organisationId, context.organisationId), eq(clientMessages.jobId, jobId))).orderBy(sql`${clientMessages.createdAt} desc`).limit(50),
      savedTemplates(tx, context.organisationId),
    ]);
    return { log: log.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })), available: (["on_the_way", "access_request"] as const).filter((key) => saved.some((row) => row.key === key && row.enabled)) };
  });
}

const londonDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(date);
const londonTime = (date: Date) => date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const londonLongDate = (date: Date) => date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });

/** Daily run: reminders for tomorrow's confirmed visits and review requests after issue. Practices opt in per template. */
export async function queueScheduledClientMessages(now = new Date()) {
  if (!process.env.DATABASE_ADMIN_URL) return { reminders: 0, reviews: 0 };
  const admin = createDatabase(process.env.DATABASE_ADMIN_URL);
  const enabled = await admin.select({ organisationId: messageTemplates.organisationId, key: messageTemplates.key }).from(messageTemplates).innerJoin(organisations, eq(organisations.id, messageTemplates.organisationId)).where(and(eq(messageTemplates.enabled, true), eq(organisations.status, "active"), inArray(messageTemplates.key, ["appointment_reminder", "review_request"])));
  let reminders = 0, reviews = 0;
  for (const organisationId of [...new Set(enabled.map((row) => row.organisationId))]) {
    const keys = new Set(enabled.filter((row) => row.organisationId === organisationId).map((row) => row.key));
    await withTenant(admin, organisationId, async (tx) => {
      if (keys.has("appointment_reminder")) {
        const tomorrow = londonDay(new Date(now.getTime() + 86_400_000));
        const visits = await tx.select({ id: appointments.id, jobId: appointments.jobId, startsAt: appointments.startsAt }).from(appointments).where(and(eq(appointments.organisationId, organisationId), eq(appointments.status, "confirmed"), gte(appointments.startsAt, now), lt(appointments.startsAt, new Date(now.getTime() + 2 * 86_400_000))));
        const due = visits.filter((visit) => londonDay(visit.startsAt) === tomorrow);
        const facts = await jobFacts(tx, organisationId, [...new Set(due.map((visit) => visit.jobId))]);
        for (const visit of due) {
          const fact = facts.find((item) => item.jobId === visit.jobId);
          if (fact) reminders += (await deliver(tx, { organisationId, facts: fact, key: "appointment_reminder", values: { appointmentDate: londonLongDate(visit.startsAt), appointmentTime: londonTime(visit.startsAt) }, dedupKey: `reminder:${visit.id}:${visit.startsAt.toISOString()}`, actorUserId: null })).filter((item) => item.status === "queued").length;
        }
      }
      if (keys.has("review_request")) {
        const [settings] = await tx.select({ reviewRequests: organisationOperationalSettings.reviewRequests }).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, organisationId)).limit(1);
        const policy = settings?.reviewRequests;
        if (policy?.enabled && policy.reviewUrl) {
          const from = new Date(now.getTime() - (policy.delayDays + 7) * 86_400_000), to = new Date(now.getTime() - policy.delayDays * 86_400_000);
          const issued = await tx.select({ jobId: jobStageEvents.jobId }).from(jobStageEvents).where(and(eq(jobStageEvents.organisationId, organisationId), eq(jobStageEvents.toStage, "issued"), gte(jobStageEvents.createdAt, from), lt(jobStageEvents.createdAt, to)));
          const facts = await jobFacts(tx, organisationId, [...new Set(issued.map((row) => row.jobId))]);
          for (const fact of facts) reviews += (await deliver(tx, { organisationId, facts: fact, key: "review_request", values: { reviewLink: policy.reviewUrl }, dedupKey: `review:${fact.jobId}`, actorUserId: null })).filter((item) => item.status === "queued").length;
        }
      }
    });
  }
  return { reminders, reviews };
}
