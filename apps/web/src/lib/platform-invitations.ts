import { platformApplicationUrl } from "./platform-application-url";
import { clerkClient } from "@clerk/nextjs/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  auditEvents,
  createDatabase,
  platformStaff,
  platformStaffInvitations,
  users,
} from "@surveynt/db";
import type { PlatformRole } from "@surveynt/domain";
export function invitationAcceptable(
  invite: {
    email: string;
    expiresAt: Date;
    revokedAt: Date | null;
    acceptedAt: Date | null;
  },
  email: string,
  verified: boolean,
  now = new Date(),
) {
  return (
    verified &&
    invite.email === email.trim().toLowerCase() &&
    !invite.revokedAt &&
    !invite.acceptedAt &&
    invite.expiresAt > now
  );
}
export async function listStaffInvitations() {
  return createDatabase(process.env.DATABASE_ADMIN_URL)
    .select()
    .from(platformStaffInvitations)
    .orderBy(sql`${platformStaffInvitations.createdAt} desc`);
}
export async function inviteStaff(
  email: string,
  role: PlatformRole,
  actorId: string,
) {
  const db = createDatabase(process.env.DATABASE_ADMIN_URL),
    clerk = await clerkClient();
  email = email.trim().toLowerCase();
  // Reserve a stable local ID before any provider side effect; remote metadata enables recovery.
  const invite = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('platform-staff-access',0))`,
    );
    const [actor] = await tx
      .select()
      .from(platformStaff)
      .where(eq(platformStaff.id, actorId));
    if (!actor?.active || actor.role !== "super_admin")
      throw Error("Only an active super administrator can invite staff.");
    const [existing] = await tx
      .select()
      .from(platformStaffInvitations)
      .where(
        and(
          eq(platformStaffInvitations.email, email),
          isNull(platformStaffInvitations.acceptedAt),
          isNull(platformStaffInvitations.revokedAt),
          sql`${platformStaffInvitations.expiresAt}>now()`,
        ),
      );
    if (existing) {
      if (existing.role !== role)
        throw Error("Revoke the pending invitation before changing its role.");
      return existing;
    }
    const [created] = await tx
      .insert(platformStaffInvitations)
      .values({
        email,
        role,
        invitedBy: actorId,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      })
      .returning();
    return created;
  });
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('platform-staff-access',0))`,
    );
    const [actor] = await tx
      .select()
      .from(platformStaff)
      .where(eq(platformStaff.id, actorId));
    const [current] = await tx
      .select()
      .from(platformStaffInvitations)
      .where(eq(platformStaffInvitations.id, invite.id));
    if (
      !actor?.active ||
      actor.role !== "super_admin" ||
      !current ||
      current.revokedAt ||
      current.acceptedAt
    )
      throw Error("Invitation no longer available.");
    if (current.clerkInvitationId) return current;
    const batch = await clerk.invitations.getInvitationList({
      query: email,
      limit: 100,
      status: "pending",
    });
    const recovered = batch.data.find(
      (i) => i.publicMetadata?.surveyntStaffInvitationId === invite.id,
    );
    const remote =
      recovered ??
      (await clerk.invitations.createInvitation({
        emailAddress: email,
        expiresInDays: 7,
        ignoreExisting: false,
        redirectUrl: `${platformApplicationUrl()}/platform-invitations/${invite.id}`,
        publicMetadata: { surveyntStaffInvitationId: invite.id },
      }));
    const [saved] = await tx
      .update(platformStaffInvitations)
      .set({ clerkInvitationId: remote.id, updatedAt: new Date() })
      .where(eq(platformStaffInvitations.id, invite.id))
      .returning();
    await tx.insert(auditEvents).values({
      platformStaffId: actorId,
      action: "platform_staff.invited",
      resourceType: "platform_staff_invitation",
      resourceId: invite.id,
      metadata: { email, role },
    });
    return saved;
  });
}
export async function revokeStaffInvitation(id: string, actorId: string) {
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const row = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('platform-staff-access',0))`,
    );
    const [actor] = await tx
      .select()
      .from(platformStaff)
      .where(eq(platformStaff.id, actorId));
    if (!actor?.active || actor.role !== "super_admin")
      throw Error("Active super administrator access required.");
    const [row] = await tx
      .select()
      .from(platformStaffInvitations)
      .where(eq(platformStaffInvitations.id, id));
    if (!row || row.acceptedAt) throw Error("Pending invitation not found.");
    await tx
      .update(platformStaffInvitations)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(platformStaffInvitations.id, id));
    await tx.insert(auditEvents).values({
      platformStaffId: actorId,
      action: "platform_staff.invitation_revoked",
      resourceType: "platform_staff_invitation",
      resourceId: id,
      metadata: { email: row.email },
    });
    return row;
  });
  const clerk = await clerkClient();
  let providerId = row.clerkInvitationId;
  if (!providerId) {
    const pending = await clerk.invitations.getInvitationList({
      query: row.email,
      status: "pending",
      limit: 100,
    });
    providerId =
      pending.data.find(
        (invite) => invite.publicMetadata?.surveyntStaffInvitationId === row.id,
      )?.id ?? null;
  }
  if (providerId && row.expiresAt > new Date()) {
    try {
      await clerk.invitations.revokeInvitation(providerId);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 404 && status !== 410) throw error;
    }
  }
  return row;
}
export async function acceptStaffInvitation(
  id: string,
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    primaryEmailAddress: {
      emailAddress: string;
      verification: { status: string } | null;
    } | null;
  },
) {
  const db = createDatabase(process.env.DATABASE_ADMIN_URL),
    email = user.primaryEmailAddress;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('platform-staff-access',0))`,
    );
    const [invite] = await tx
      .select()
      .from(platformStaffInvitations)
      .where(eq(platformStaffInvitations.id, id));
    if (invite?.acceptedBy === user.id && !invite.revokedAt) return;
    if (
      !invite ||
      !email ||
      !invitationAcceptable(
        invite,
        email.emailAddress,
        email.verification?.status === "verified",
      )
    )
      throw Error(
        "Invitation expired, revoked, or belongs to a different verified email.",
      );
    if (!invite.clerkInvitationId)
      throw Error("Invitation delivery has not completed.");
    const accepted = await (
      await clerkClient()
    ).invitations.getInvitationList({
      query: invite.clerkInvitationId,
      status: "accepted",
      limit: 10,
    });
    if (
      !accepted.data.some(
        (i) =>
          i.id === invite.clerkInvitationId &&
          i.emailAddress.toLowerCase() === invite.email,
      )
    )
      throw Error("Accept the Clerk email invitation before continuing.");
    await tx
      .insert(users)
      .values({
        clerkUserId: user.id,
        email: invite.email,
        firstName: user.firstName,
        lastName: user.lastName,
      })
      .onConflictDoUpdate({
        target: users.clerkUserId,
        set: { email: invite.email, updatedAt: new Date() },
      });
    const [staff] = await tx
      .insert(platformStaff)
      .values({ clerkUserId: user.id, role: invite.role, active: true })
      .onConflictDoUpdate({
        target: platformStaff.clerkUserId,
        set: { role: invite.role, active: true, updatedAt: new Date() },
      })
      .returning();
    await tx
      .update(platformStaffInvitations)
      .set({
        acceptedBy: user.id,
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(platformStaffInvitations.id, id));
    await tx.insert(auditEvents).values({
      platformStaffId: staff.id,
      action: "platform_staff.invitation_accepted",
      resourceType: "platform_staff_invitation",
      resourceId: id,
      metadata: {
        email: invite.email,
        role: invite.role,
        invitedBy: invite.invitedBy,
      },
    });
  });
}
