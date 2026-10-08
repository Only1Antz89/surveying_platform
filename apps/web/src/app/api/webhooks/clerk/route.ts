import { createHash } from "node:crypto";
import { Webhook } from "svix";
import { z } from "zod";
import { organisationRoles, type OrganisationRole } from "@surveynt/domain";
import { auditEvents, createDatabase, invitations, organisationMemberships, organisations, platformStaff, users, webhookEvents } from "@surveynt/db";
import { changedAccountProfileFields } from "@/lib/account-profile-audit";
import { and, eq, isNotNull, sql } from "drizzle-orm";

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
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  let [claim] = await db.insert(webhookEvents).values({ provider: "clerk", providerEventId: eventId, eventType: parsed.data.type, payloadHash }).onConflictDoNothing().returning({ id: webhookEvents.id });
  if (!claim) {
    const [existing] = await db.select().from(webhookEvents).where(and(eq(webhookEvents.provider, "clerk"), eq(webhookEvents.providerEventId, eventId))).limit(1);
    if (!existing || existing.payloadHash !== payloadHash) return Response.json({ error: "Webhook event identity conflict." }, { status: 409 });
    if (existing.processedAt || !existing.failedAt) return Response.json({ received: true, duplicate: true });
    [claim] = await db.update(webhookEvents).set({ failedAt: null, error: null }).where(and(eq(webhookEvents.id, existing.id), isNotNull(webhookEvents.failedAt))).returning({ id: webhookEvents.id });
    if (!claim) return Response.json({ received: true, duplicate: true });
  }
  try {
    await db.transaction(async tx => {
      if (parsed.data.type === "organization.created") {
        const data = z.object({ id: z.string(), name: z.string(), slug: z.string().nullable().optional() }).parse(parsed.data.data);
        await tx.insert(organisations).values({ clerkOrganisationId: data.id, name: data.name, slug: data.slug ?? `practice-${data.id.slice(-8)}`, practiceType: "multi-disciplinary", region: "United Kingdom" }).onConflictDoNothing();
      }
      if (parsed.data.type === "user.created" || parsed.data.type === "user.updated") {
        const data = z.object({
          id: z.string(),
          updated_at: z.number().int().nonnegative().max(8640000000000000),
          image_url: z.string().max(8192).optional(),
          has_image: z.boolean().optional(),
          first_name: z.string().nullable().optional(),
          last_name: z.string().nullable().optional(),
          email_addresses: z.array(z.object({
            email_address: z.string(),
            id: z.string(),
            verification: z.object({ status: z.string().nullable().optional() }).nullable().optional(),
          })).default([]),
          primary_email_address_id: z.string().nullable().optional(),
        }).refine(data=>data.has_image!==true||Boolean(data.image_url),{message:"Custom profile image identity is required."}).parse(parsed.data.data);
        const email = data.email_addresses.find((item) => item.id === data.primary_email_address_id)?.email_address ?? data.email_addresses[0]?.email_address ?? "unknown@surveynt.invalid";
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`account-profile:${data.id}`},0))`);
        const [previous]=await tx.select({id:users.id,clerkProfileUpdatedAt:users.clerkProfileUpdatedAt,clerkProfileImageFingerprint:users.clerkProfileImageFingerprint,email:users.email,firstName:users.firstName,lastName:users.lastName}).from(users).where(eq(users.clerkUserId,data.id)).limit(1);
        const providerUpdatedAt=new Date(data.updated_at);
        if(previous?.clerkProfileUpdatedAt&&providerUpdatedAt<=previous.clerkProfileUpdatedAt){
          await tx.insert(auditEvents).values({action:"account.profile_event_ignored",resourceType:"user",resourceId:previous.id,metadata:{source:"verified_clerk_webhook",providerEventId:eventId,webhookEventId:claim.id,reason:"provider_revision_not_newer",providerUpdatedAt:providerUpdatedAt.toISOString()}});
        }else{
          // Keep provider image identity out of audit metadata; an omitted legacy
          // snapshot must not falsely record removal of an existing photo.
          const imageFingerprint=data.has_image===false?createHash("sha256").update("no-custom-image").digest("hex"):data.has_image===true&&data.image_url?createHash("sha256").update(data.image_url).digest("hex"):undefined;
          const imageUpdate=imageFingerprint===undefined?{}:{clerkProfileImageFingerprint:imageFingerprint};
          const [synchronised]=await tx.insert(users).values({ ...imageUpdate, clerkUserId: data.id, clerkProfileUpdatedAt:providerUpdatedAt, email, firstName: data.first_name, lastName: data.last_name }).onConflictDoUpdate({ target: users.clerkUserId, set: { ...imageUpdate, clerkProfileUpdatedAt:providerUpdatedAt, email, firstName: data.first_name, lastName: data.last_name, updatedAt: new Date() } }).returning({id:users.id,email:users.email,firstName:users.firstName,lastName:users.lastName});
          const changedFields=changedAccountProfileFields(previous??null,synchronised);
          if(imageFingerprint!==undefined&&imageFingerprint!==previous?.clerkProfileImageFingerprint)changedFields.push("photo");
          if(changedFields.length)await tx.insert(auditEvents).values({action:previous?"account.profile_synchronised":"account.created",resourceType:"user",resourceId:synchronised.id,metadata:{source:"verified_clerk_webhook",providerEventId:eventId,webhookEventId:claim.id,changedFields}});
          const verifiedEmail = data.email_addresses.find((item) => item.email_address.toLowerCase() === email.toLowerCase() && item.verification?.status === "verified");
          if (verifiedEmail && isBootstrapSuperAdmin(verifiedEmail.email_address)) {
            await tx.insert(platformStaff).values({ clerkUserId: data.id, role: "super_admin", active: true }).onConflictDoUpdate({ target: platformStaff.clerkUserId, set: { role: "super_admin", active: true, updatedAt: new Date() } });
          }
        }
      }
      if (parsed.data.type === "organizationMembership.created" || parsed.data.type === "organizationMembership.updated" || parsed.data.type === "organizationMembership.deleted") {
        const data = z.object({
          role: z.string(),
          public_metadata: z.record(z.string(), z.unknown()).default({}),
          organization: z.object({ id: z.string() }),
          public_user_data: z.object({ user_id: z.string(), identifier: z.string(), first_name: z.string().nullable().optional(), last_name: z.string().nullable().optional() }),
        }).parse(parsed.data.data);
        const [organisation] = await tx.select({ id: organisations.id }).from(organisations).where(eq(organisations.clerkOrganisationId, data.organization.id)).limit(1);
        if (!organisation) throw new Error("Organisation has not been synchronised yet. Retry this event after organization.created.");
        if (organisation) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`account-profile:${data.public_user_data.user_id}`},0))`);
          const [seededUser] = await tx.insert(users).values({ clerkUserId: data.public_user_data.user_id, email: data.public_user_data.identifier, firstName: data.public_user_data.first_name, lastName: data.public_user_data.last_name }).onConflictDoNothing().returning({ id: users.id });
          const memberUser=seededUser??(await tx.select({id:users.id}).from(users).where(eq(users.clerkUserId,data.public_user_data.user_id)).limit(1))[0];
          if(!memberUser)throw new Error("The membership account has not been synchronised. Retry this event.");
          if(seededUser)await tx.insert(auditEvents).values({action:"account.created",resourceType:"user",resourceId:seededUser.id,metadata:{source:"verified_clerk_membership_webhook",providerEventId:eventId,webhookEventId:claim.id,changedFields:["email","firstName","lastName"]}});
          const [current] = await tx.select({ id: organisationMemberships.id, role: organisationMemberships.role }).from(organisationMemberships).where(and(eq(organisationMemberships.organisationId, organisation.id), eq(organisationMemberships.userId, memberUser.id))).limit(1);
          const role = membershipRole(data.role, data.public_metadata, current?.role);
          const active = parsed.data.type !== "organizationMembership.deleted";
          await tx.insert(organisationMemberships).values({ organisationId: organisation.id, userId: memberUser.id, role, active }).onConflictDoUpdate({ target: [organisationMemberships.organisationId, organisationMemberships.userId], set: { role, active, ...(current && current.role !== role ? { canRecordSurvey: false, canApproveReports: false } : {}), updatedAt: new Date() } });
          await tx.insert(auditEvents).values({ organisationId: organisation.id, action: active ? "membership.synchronised" : "membership.deactivated", resourceType: "membership", resourceId: current?.id, metadata: { clerkUserId: data.public_user_data.user_id, role } });
        }
      }
      if (parsed.data.type === "organizationInvitation.accepted") {
        const data = z.object({ id: z.string(), organization_id: z.string(), user_id: z.string() }).parse(parsed.data.data);
        const [organisation] = await tx.select({ id: organisations.id }).from(organisations).where(eq(organisations.clerkOrganisationId, data.organization_id)).limit(1);
        if (!organisation) throw new Error("Organisation has not been synchronised yet. Retry this invitation event.");
        await tx.update(invitations).set({ acceptedAt: new Date(), updatedAt: new Date() }).where(and(eq(invitations.organisationId, organisation.id), eq(invitations.clerkInvitationId, data.id)));
      }
      if (parsed.data.type === "organizationInvitation.revoked") {
        const data = z.object({ id: z.string(), organization_id: z.string() }).parse(parsed.data.data);
        const [organisation] = await tx.select({ id: organisations.id }).from(organisations).where(eq(organisations.clerkOrganisationId, data.organization_id)).limit(1);
        if (!organisation) throw new Error("Organisation has not been synchronised yet. Retry this invitation event.");
        await tx.update(invitations).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(invitations.organisationId, organisation.id), eq(invitations.clerkInvitationId, data.id)));
      }
      await tx.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, claim.id));
    });
    return Response.json({ received: true });
  } catch (reason) {
    await db.update(webhookEvents).set({ failedAt: new Date(), error: reason instanceof Error ? reason.message.slice(0, 1000) : "Unknown processing error" }).where(eq(webhookEvents.id, claim.id));
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
