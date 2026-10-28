import "server-only";
import { eq, sql, and, isNull, isNotNull } from "drizzle-orm";
import {
  auditEvents,
  createDatabase,
  organisations,
  platformStaff,
  users,
  organisationMemberships,
} from "@surveynt/db";
import {
  canManageEngagement,
  completeFollowupInput,
  followupInput,
} from "./customer-lifecycle";
import type { z } from "zod";
export class EngagementError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function createFollowup(
  input: z.infer<typeof followupInput>,
  operator: { role: string; platformStaffId: string },
) {
  if (!canManageEngagement(operator.role))
    throw new EngagementError(403, "Customer engagement access required.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  return db.transaction(async (tx) => {
    // One append-only creation event per client request, including concurrent retries.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.requestId},0))`,
    );
    const [prior] = await tx
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "platform.engagement.followup_created"),
          eq(auditEvents.resourceId, input.requestId),
          isNull(auditEvents.organisationId),
          isNotNull(auditEvents.platformStaffId),
        ),
      )
      .limit(1);
    if (prior) {
      const same =
        prior.platformStaffId === operator.platformStaffId &&
        Object.entries(input).every(
          ([key, value]) =>
            key === "requestId" || prior.metadata[key] === value,
        );
      if (!same)
        throw new EngagementError(
          409,
          "This request has already been used for another follow-up.",
        );
      return { id: input.requestId };
    }
    const [assignee] = await tx
      .select()
      .from(platformStaff)
      .where(
        and(
          eq(platformStaff.id, input.assigneeId),
          eq(platformStaff.active, true),
        ),
      )
      .limit(1);
    if (!assignee || !canManageEngagement(assignee.role))
      throw new EngagementError(
        422,
        "Choose an active engagement team member.",
      );
    if (input.targetType === "customer") {
      const [target] = await tx
        .select({ id: organisations.id })
        .from(organisations)
        .where(eq(organisations.id, input.targetId))
        .limit(1);
      if (!target) throw new EngagementError(404, "Customer not found.");
    } else {
      // A prospect is an authenticated setup visitor, never an arbitrary browser-supplied email.
      const target = await tx.execute(
        sql`select u.id from users u where u.id=${input.targetId} and exists(select 1 from audit_events a where a.actor_user_id=u.id and a.action='customer.practice_form_viewed' and a.organisation_id is null and a.platform_staff_id is null) and not exists(select 1 from organisation_memberships m where m.user_id=u.id and m.active) and not exists(select 1 from platform_staff p where p.clerk_user_id=u.clerk_user_id) and not exists(select 1 from platform_staff_invitations i where lower(i.email)=lower(u.email) and i.revoked_at is null and i.expires_at>now())`,
      );
      if (!target.rows.length)
        throw new EngagementError(
          404,
          "Eligible prospect not found. Refresh the customer list.",
        );
    }
    await tx.insert(auditEvents).values({
      organisationId: null,
      platformStaffId: operator.platformStaffId,
      action: "platform.engagement.followup_created",
      resourceType: "customer_followup",
      resourceId: input.requestId,
      metadata: input,
    });
    return { id: input.requestId };
  });
}
export async function completeFollowup(
  id: string,
  input: z.infer<typeof completeFollowupInput>,
  operator: { role: string; platformStaffId: string },
) {
  if (!canManageEngagement(operator.role))
    throw new EngagementError(403, "Customer engagement access required.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${id},0))`,
    );
    const [task] = await tx
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, id),
          isNull(auditEvents.organisationId),
          isNotNull(auditEvents.platformStaffId),
          eq(auditEvents.action, "platform.engagement.followup_created"),
        ),
      )
      .limit(1);
    if (!task) throw new EngagementError(404, "Follow-up not found.");
    const [done] = await tx
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, id),
          isNull(auditEvents.organisationId),
          isNotNull(auditEvents.platformStaffId),
          eq(auditEvents.action, "platform.engagement.followup_completed"),
        ),
      )
      .limit(1);
    if (done)
      throw new EngagementError(
        409,
        "This follow-up is already completed. Refresh to see its outcome.",
      );
    await tx.insert(auditEvents).values({
      organisationId: task.organisationId,
      platformStaffId: operator.platformStaffId,
      action: "platform.engagement.followup_completed",
      resourceType: "customer_followup",
      resourceId: id,
      metadata: {
        ...input,
        targetType: task.metadata.targetType,
        targetId: task.metadata.targetId,
      },
    });
    return { id };
  });
}
/** Best-effort measurement must never prevent a customer from continuing setup. */
export async function recordPracticeVisit(user: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddress: {
    emailAddress: string;
    verification: { status: string } | null;
  } | null;
}) {
  const email = user.primaryEmailAddress;
  if (
    !email ||
    email.verification?.status !== "verified" ||
    !process.env.DATABASE_ADMIN_URL
  )
    return;
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`setup-visit:${user.id}`},0))`,
    );
    const [staff] = await tx
      .select({ id: platformStaff.id })
      .from(platformStaff)
      .where(eq(platformStaff.clerkUserId, user.id))
      .limit(1);
    if (staff) return;
    const [local] = await tx
      .insert(users)
      .values({
        clerkUserId: user.id,
        email: email.emailAddress,
        firstName: user.firstName,
        lastName: user.lastName,
      })
      .onConflictDoNothing()
      .returning({ id: users.id });
    const id =
      local?.id ??
      (
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.clerkUserId, user.id))
          .limit(1)
      )[0]?.id;
    if (!id) return;
    const [member] = await tx
      .select({ id: organisationMemberships.id })
      .from(organisationMemberships)
      .where(
        and(
          eq(organisationMemberships.userId, id),
          eq(organisationMemberships.active, true),
        ),
      )
      .limit(1);
    if (member) return;
    // Daily deduplication avoids inflating return visits on reload or React remount.
    const existing = await tx.execute(
      sql`select id from audit_events where actor_user_id=${id} and action='customer.practice_form_viewed' and (occurred_at at time zone 'Europe/London')::date=(now() at time zone 'Europe/London')::date limit 1`,
    );
    if (existing.rows.length) return;
    await tx.insert(auditEvents).values({
      actorUserId: id,
      action: "customer.practice_form_viewed",
      resourceType: "customer_signup",
      resourceId: id,
      metadata: { source: "authenticated_setup" },
    });
  });
}

/** Called only with server-resolved active membership, with no customer IDs from the request body. */
export async function recordWorkspaceVisit(context: {
  organisationId: string;
  internalUserId: string;
  userId: string;
}) {
  if (!process.env.DATABASE_ADMIN_URL) return;
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`workspace-visit:${context.organisationId}:${context.internalUserId}`},0))`,
    );
    const [staff] = await tx
      .select({ id: platformStaff.id })
      .from(platformStaff)
      .where(eq(platformStaff.clerkUserId, context.userId))
      .limit(1);
    if (staff) return;
    const existing = await tx.execute(
      sql`select id from audit_events where organisation_id=${context.organisationId} and actor_user_id=${context.internalUserId} and action='customer.workspace_visited' and (occurred_at at time zone 'Europe/London')::date=(now() at time zone 'Europe/London')::date limit 1`,
    );
    if (existing.rows.length) return;
    await tx
      .insert(auditEvents)
      .values({
        organisationId: context.organisationId,
        actorUserId: context.internalUserId,
        action: "customer.workspace_visited",
        resourceType: "customer_engagement",
        resourceId: context.organisationId,
        metadata: { source: "authenticated_workspace" },
      });
  });
}
