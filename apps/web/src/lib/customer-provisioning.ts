import { platformApplicationUrl } from "./platform-application-url";
import { createHash } from "node:crypto";
import { z } from "zod";
import { clerkClient } from "@clerk/nextjs/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  auditEvents,
  createDatabase,
  customerProvisioning,
  invitations,
  onboardingSteps,
  organisationBranding,
  organisationMemberships,
  organisations,
  users,
} from "@surveynt/db";
export const customerInput = z.object({
  firmName: z.string().trim().min(2).max(160),
  practiceType: z.enum([
    "residential-building-surveying",
    "commercial-building-surveying",
    "valuation",
    "multi-disciplinary",
  ]),
  teamSize: z.enum(["1-5", "6-15", "16-50", "51+"]),
  region: z.enum([
    "London",
    "South East England",
    "South West England",
    "Midlands",
    "North of England",
    "Wales",
    "Scotland",
    "Northern Ireland",
  ]),
});
export const manualCustomerInput = customerInput.extend({
  ownerEmail: z.email().transform((v) => v.trim().toLowerCase()),
});
export const seatsForTeamSize = {
  "1-5": 5,
  "6-15": 15,
  "16-50": 50,
  "51+": 100,
} as const;
export function provisioningKey(email: string, firmName: string) {
  return createHash("sha256")
    .update(`${email.trim().toLowerCase()}:${firmName.trim().toLowerCase()}`)
    .digest("hex");
}
export async function provisionCustomer(
  input: z.infer<typeof customerInput>,
  owner: {
    email: string;
    userId?: string;
    firstName?: string | null;
    lastName?: string | null;
  },
  platformStaffId?: string,
) {
  const db = createDatabase(process.env.DATABASE_ADMIN_URL),
    clerk = await clerkClient(),
    key = provisioningKey(owner.email, input.firmName);
  const [request] = await db
    .insert(customerProvisioning)
    .values({
      requestKey: key,
      ownerEmail: owner.email.toLowerCase(),
      input,
      requestedBy: platformStaffId,
    })
    .onConflictDoUpdate({
      target: customerProvisioning.requestKey,
      set: { updatedAt: new Date() },
    })
    .returning();
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`provision:${key}`},0))`,
      );
      const [current] = await tx
        .select()
        .from(customerProvisioning)
        .where(eq(customerProvisioning.id, request.id));
      if (current.state === "complete" && current.organisationId) {
        const [existing] = await tx
          .select()
          .from(organisations)
          .where(eq(organisations.id, current.organisationId));
        return {
          ...existing,
          seats: seatsForTeamSize[input.teamSize],
          existing: true,
        };
      }
      // Provider metadata recovers a successful remote create after a process/DB failure.
      let remote = current.clerkOrganisationId
        ? await clerk.organizations.getOrganization({
            organizationId: current.clerkOrganisationId,
          })
        : null;
      if (!remote) {
        for (let offset = 0; ; offset += 100) {
          const batch = await clerk.organizations.getOrganizationList({
            query: input.firmName,
            limit: 100,
            offset,
          });
          remote =
            batch.data.find(
              (o) => o.privateMetadata.surveyntProvisioningKey === key,
            ) ?? null;
          if (remote || offset + 100 >= batch.totalCount) break;
        }
      }
      if (!remote) {
        if (current.remoteCreateAttempted)
          throw Error(
            "A previous provider create has an unknown outcome. Retry after the provider account becomes visible; do not issue another create.",
          );
        // Commit the attempt marker independently before calling Clerk. An unknown remote outcome must fail closed.
        await db
          .update(customerProvisioning)
          .set({ remoteCreateAttempted: true })
          .where(eq(customerProvisioning.id, current.id));
        try {
          remote = await clerk.organizations.createOrganization({
            name: input.firmName,
            ...(owner.userId ? { createdBy: owner.userId } : {}),
            privateMetadata: { surveyntProvisioningKey: key },
            publicMetadata: {
              surveyntPracticeType: input.practiceType,
              surveyntRegion: input.region,
              surveyntTeamSize: input.teamSize,
            },
          });
        } catch (error) {
          const status = (error as { status?: number }).status;
          if (status && status >= 400 && status < 500 && status !== 408)
            await db
              .update(customerProvisioning)
              .set({ remoteCreateAttempted: false })
              .where(eq(customerProvisioning.id, current.id));
          throw error;
        }
      }
      const [org] = await tx
        .insert(organisations)
        .values({
          clerkOrganisationId: remote.id,
          name: input.firmName,
          slug: remote.slug ?? `practice-${remote.id.slice(-8)}`,
          practiceType: input.practiceType,
          region: input.region,
          status: "provisioning",
        })
        .onConflictDoUpdate({
          target: organisations.clerkOrganisationId,
          set: {
            name: input.firmName,
            practiceType: input.practiceType,
            region: input.region,
            updatedAt: new Date(),
          },
        })
        .returning();
      let internalUserId: string | undefined;
      if (owner.userId) {
        const [user] = await tx
          .insert(users)
          .values({
            clerkUserId: owner.userId,
            email: owner.email.toLowerCase(),
            firstName: owner.firstName,
            lastName: owner.lastName,
          })
          .onConflictDoUpdate({
            target: users.clerkUserId,
            set: { email: owner.email.toLowerCase(), updatedAt: new Date() },
          })
          .returning();
        internalUserId = user.id;
        await tx
          .insert(organisationMemberships)
          .values({
            organisationId: org.id,
            userId: user.id,
            role: "owner",
            active: true,
          })
          .onConflictDoNothing();
      }
      await tx
        .insert(organisationBranding)
        .values({
          organisationId: org.id,
          tradingName: input.firmName,
          supportEmail: owner.email.toLowerCase(),
          accentColour: "#3b82f6",
        })
        .onConflictDoNothing();
      await tx
        .insert(onboardingSteps)
        .values(
          [
            "practice_details",
            "report_templates",
            "billing",
            "services",
            "first_teammate",
          ].map((key) => ({
            organisationId: org.id,
            key,
            ...(key === "practice_details"
              ? { completedAt: new Date(), completedByUserId: internalUserId }
              : {}),
          })),
        )
        .onConflictDoNothing();
      let invitationId = current.clerkInvitationId;
      if (!owner.userId && !invitationId) {
        let found;
        for (let offset = 0; ; offset += 100) {
          const page = await clerk.organizations.getOrganizationInvitationList({
            organizationId: remote.id,
            status: ["pending", "accepted"],
            limit: 100,
            offset,
          });
          found = page.data.find(
            (i) => i.emailAddress.toLowerCase() === owner.email.toLowerCase(),
          );
          if (found || offset + 100 >= page.totalCount) break;
        }
        const invitation =
          found ??
          (await clerk.organizations.createOrganizationInvitation({
            organizationId: remote.id,
            emailAddress: owner.email.toLowerCase(),
            role: "org:admin",
            expiresInDays: 14,
            redirectUrl: `${platformApplicationUrl()}/start`,
            publicMetadata: { surveyntRole: "owner" },
          }));
        invitationId = invitation.id;
        await tx
          .insert(invitations)
          .values({
            organisationId: org.id,
            clerkInvitationId: invitation.id,
            email: owner.email.toLowerCase(),
            role: "owner",
            expiresAt: new Date(invitation.expiresAt),
            ...(invitation.status === "accepted"
              ? { acceptedAt: new Date() }
              : {}),
          })
          .onConflictDoNothing();
      }
      await tx
        .update(customerProvisioning)
        .set({
          organisationId: org.id,
          clerkOrganisationId: remote.id,
          clerkInvitationId: invitationId,
          state: "complete",
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(customerProvisioning.id, current.id));
      await tx
        .insert(auditEvents)
        .values({
          organisationId: org.id,
          actorUserId: internalUserId,
          platformStaffId,
          action: platformStaffId
            ? "customer.created_by_operator"
            : "onboarding.started",
          resourceType: "organisation",
          resourceId: org.id,
          metadata: { ownerEmail: owner.email, requestId: current.id },
        });
      return {
        ...org,
        seats: seatsForTeamSize[input.teamSize],
        existing: false,
      };
    });
  } catch (error) {
    await db
      .update(customerProvisioning)
      .set({
        state: "failed",
        error:
          "Provisioning interrupted. Retry the same firm and owner to resume safely.",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerProvisioning.id, request.id),
          sql`${customerProvisioning.state} <> 'complete'`,
        ),
      );
    throw error;
  }
}

/** Reconcile the invited owner synchronously; account setup must not race the webhook. */
export async function reconcileInvitedOwner(
  owner: {
    email: string;
    userId: string;
    firstName?: string | null;
    lastName?: string | null;
  },
  activeOrgId?: string | null,
) {
  const db = createDatabase(process.env.DATABASE_ADMIN_URL),
    clerk = await clerkClient();
  const requests = await db
    .select()
    .from(customerProvisioning)
    .where(
      and(
        eq(customerProvisioning.ownerEmail, owner.email.toLowerCase()),
        isNotNull(customerProvisioning.requestedBy),
        eq(customerProvisioning.state, "complete"),
      ),
    );
  for (const request of requests) {
    if (
      !request.clerkOrganisationId ||
      !request.organisationId ||
      (activeOrgId && request.clerkOrganisationId !== activeOrgId)
    )
      continue;
    const membership = await clerk.organizations.getOrganizationMembershipList({
      organizationId: request.clerkOrganisationId,
      userId: [owner.userId],
      limit: 10,
    });
    if (
      !membership.data.some(
        (m) =>
          m.role === "org:admin" && m.publicUserData?.userId === owner.userId,
      )
    )
      continue;
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`invited-owner:${request.organisationId}`},0))`,
      );
      const [user] = await tx
        .insert(users)
        .values({
          clerkUserId: owner.userId,
          email: owner.email.toLowerCase(),
          firstName: owner.firstName,
          lastName: owner.lastName,
        })
        .onConflictDoUpdate({
          target: users.clerkUserId,
          set: { email: owner.email.toLowerCase(), updatedAt: new Date() },
        })
        .returning();
      const [existing] = await tx
        .select()
        .from(organisationMemberships)
        .where(
          and(
            eq(organisationMemberships.organisationId, request.organisationId!),
            eq(organisationMemberships.userId, user.id),
          ),
        );
      if (!existing) {
        await tx
          .insert(organisationMemberships)
          .values({
            organisationId: request.organisationId!,
            userId: user.id,
            role: "owner",
            active: true,
          });
        await tx
          .insert(auditEvents)
          .values({
            organisationId: request.organisationId!,
            actorUserId: user.id,
            action: "customer.owner_invitation_reconciled",
            resourceType: "organisation",
            resourceId: request.organisationId!,
          });
      }
      const [org] = await tx
        .select()
        .from(organisations)
        .where(eq(organisations.id, request.organisationId!));
      return {
        ...org,
        seats: seatsForTeamSize[customerInput.parse(request.input).teamSize],
        existing: true,
      };
    });
  }
  return null;
}
