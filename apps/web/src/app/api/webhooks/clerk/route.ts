import { createHash } from "node:crypto";
import { Webhook } from "svix";
import { z } from "zod";
import { organisationRoles, type OrganisationRole } from "@surveynt/domain";
import { auditEvents, createDatabase, invitations, organisationMemberships, organisations, platformStaff, users, webhookEvents } from "@surveynt/db";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

const eventSchema = z.object({ type: z.string(), data: z.record(z.string(), z.unknown()), object: z.string().optional() });
const organisationRoleSchema = z.enum(organisationRoles);

function membershipRole(clerkRole: string, metadata: Record<string, unknown>, current?: OrganisationRole): OrganisationRole {
  // Read the former key so existing Clerk memberships keep their assigned role.
  const configured = organisationRoleSchema.safeParse(metadata.surveyntRole ?? metadata.fieldnoteRole);
  if (configured.success) return configured.data;
  if (current) return current;
  return clerkRole === "org:admin" ? "administrator" : "surveyor";
}

function isBootstrapSuperAdmin(email: string) {
  const configured = process.env.PLATFORM_SUPER_ADMIN_EMAILS ?? "";
  const allowed = configured.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

export async function POST(request: Request) {
  if (!process.env.CLERK_WEBHOOK_SECRET || !process.env.DATABASE_ADMIN_URL) return Response.json({ error: "Webhook infrastructure is not configured." }, { status: 503 });
  const payload = await request.text();
  const headers = { "svix-id": request.headers.get("svix-id") ?? "", "svix-timestamp": request.headers.get("svix-timestamp") ?? "", "svix-signature": request.headers.get("svix-signature") ?? "" };
  let verified: unknown;
  try { verified = new Webhook(process.env.CLERK_WEBHOOK_SECRET).verify(payload, headers); }
  catch { return Response.json({ error: "Invalid Clerk signature." }, { status: 400 }); }
  const parsed = eventSchema.safeParse(verified);
  if (!parsed.success) return Response.json({ error: "Invalid Clerk event." }, { status: 400 });
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const eventId = headers["svix-id"];
  const [claim] = await db.insert(webhookEvents).values({ provider: "clerk", providerEventId: eventId, eventType: parsed.data.type, payloadHash: createHash("sha256").update(payload).digest("hex") }).onConflictDoNothing().returning({ id: webhookEvents.id });
  if (!claim) return Response.json({ received: true, duplicate: true });
  try {
    if (parsed.data.type === "organization.created") {
      const data = z.object({ id: z.string(), name: z.string(), slug: z.string().nullable().optional() }).parse(parsed.data.data);
      await db.insert(organisations).values({ clerkOrganisationId: data.id, name: data.name, slug: data.slug ?? `practice-${data.id.slice(-8)}`, practiceType: "multi-disciplinary", region: "United Kingdom" }).onConflictDoNothing();
    }
    if (parsed.data.type === "user.created" || parsed.data.type === "user.updated") {
      const data = z.object({
        id: z.string(),
        first_name: z.string().nullable().optional(),
        last_name: z.string().nullable().optional(),
        email_addresses: z.array(z.object({
          email_address: z.string(),
          id: z.string(),
          verification: z.object({ status: z.string().nullable().optional() }).nullable().optional(),
        })).default([]),
        primary_email_address_id: z.string().nullable().optional(),
      }).parse(parsed.data.data);
      const email = data.email_addresses.find((item) => item.id === data.primary_email_address_id)?.email_address ?? data.email_addresses[0]?.email_address ?? "unknown@surveynt.invalid";
      await db.insert(users).values({ clerkUserId: data.id, email, firstName: data.first_name, lastName: data.last_name }).onConflictDoUpdate({ target: users.clerkUserId, set: { email, firstName: data.first_name, lastName: data.last_name, updatedAt: new Date() } });
      const verifiedEmail = data.email_addresses.find((item) => item.email_address.toLowerCase() === email.toLowerCase() && item.verification?.status === "verified");
      if (verifiedEmail && isBootstrapSuperAdmin(verifiedEmail.email_address)) {
        await db.insert(platformStaff).values({ clerkUserId: data.id, role: "super_admin", active: true }).onConflictDoUpdate({ target: platformStaff.clerkUserId, set: { role: "super_admin", active: true, updatedAt: new Date() } });
      }
    }
    if (parsed.data.type === "organizationMembership.created" || parsed.data.type === "organizationMembership.updated" || parsed.data.type === "organizationMembership.deleted") {
      const data = z.object({
        role: z.string(),
        public_metadata: z.record(z.string(), z.unknown()).default({}),
        organization: z.object({ id: z.string() }),
        public_user_data: z.object({ user_id: z.string(), identifier: z.string(), first_name: z.string().nullable().optional(), last_name: z.string().nullable().optional() }),
      }).parse(parsed.data.data);
      const [organisation] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.clerkOrganisationId, data.organization.id)).limit(1);
      if (organisation) {
        const [memberUser] = await db.insert(users).values({ clerkUserId: data.public_user_data.user_id, email: data.public_user_data.identifier, firstName: data.public_user_data.first_name, lastName: data.public_user_data.last_name }).onConflictDoUpdate({ target: users.clerkUserId, set: { email: data.public_user_data.identifier, firstName: data.public_user_data.first_name, lastName: data.public_user_data.last_name, updatedAt: new Date() } }).returning({ id: users.id });
        const [current] = await db.select({ id: organisationMemberships.id, role: organisationMemberships.role }).from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, organisation.id), eq(organisationMemberships.userId, memberUser.id))).limit(1);
        const role = membershipRole(data.role, data.public_metadata, current?.role);
        const active = parsed.data.type !== "organizationMembership.deleted";
        await db.insert(organisationMemberships).values({ organisationId: organisation.id, userId: memberUser.id, role, active }).onConflictDoUpdate({ target: [organisationMemberships.organisationId, organisationMemberships.userId], set: { role, active, ...(current && current.role !== role ? { canRecordSurvey: false, canApproveReports: false } : {}), updatedAt: new Date() } });
        await db.insert(auditEvents).values({ organisationId: organisation.id, action: active ? "membership.synchronised" : "membership.deactivated", resourceType: "membership", resourceId: current?.id, metadata: { clerkUserId: data.public_user_data.user_id, role } });
      }
    }
    if (parsed.data.type === "organizationInvitation.accepted") {
      const data = z.object({ id: z.string(), organization_id: z.string(), user_id: z.string() }).parse(parsed.data.data);
      const [organisation] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.clerkOrganisationId, data.organization_id)).limit(1);
      if (organisation) await db.update(invitations).set({ acceptedAt: new Date(), updatedAt: new Date() }).where(and(eq(invitations.organisationId, organisation.id), eq(invitations.clerkInvitationId, data.id)));
    }
    if (parsed.data.type === "organizationInvitation.revoked") {
      const data = z.object({ id: z.string(), organization_id: z.string() }).parse(parsed.data.data);
      const [organisation] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.clerkOrganisationId, data.organization_id)).limit(1);
      if (organisation) await db.update(invitations).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(invitations.organisationId, organisation.id), eq(invitations.clerkInvitationId, data.id)));
    }
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, claim.id));
    return Response.json({ received: true });
  } catch (reason) {
    await db.update(webhookEvents).set({ failedAt: new Date(), error: reason instanceof Error ? reason.message.slice(0, 1000) : "Unknown processing error" }).where(eq(webhookEvents.id, claim.id));
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
