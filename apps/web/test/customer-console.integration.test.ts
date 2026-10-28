import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  createTestDatabase,
  integrationEnabled,
  stopRelay,
  type TestDatabase,
} from "@surveynt/db/testing";
import {
  organisations,
  users,
  organisationMemberships,
  platformStaff,
  platformStaffInvitations,
  customerProvisioning,
  subscriptions,
  onboardingSteps,
  auditEvents,
  type Database,
} from "@surveynt/db";
const fixture = vi.hoisted(() => ({
  session: { userId: "console_admin", orgId: null as string | null },
  remotes: [] as {
    id: string;
    name: string;
    slug: string | null;
    privateMetadata: Record<string, unknown>;
  }[],
  invites: [] as {
    id: string;
    emailAddress: string;
    status: string;
    publicMetadata: Record<string, unknown>;
    expiresAt: number;
  }[],
  ownerInvites: [] as {
    id: string;
    emailAddress: string;
    status: string;
    expiresAt: number;
  }[],
  memberships: [] as { role: string; publicUserData: { userId: string } }[],
  createdWith: [] as Record<string, unknown>[],
  failAfterCreate: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ ...fixture.session }),
  clerkClient: async () => ({
    users: {
      getUserList: async ({ emailAddress }: { emailAddress: string[] }) => ({
        data: emailAddress.includes("existing@console.test")
          ? [
              {
                id: "console_existing",
                firstName: "Existing",
                lastName: "Operator",
                emailAddresses: [
                  {
                    emailAddress: "existing@console.test",
                    verification: { status: "verified" },
                  },
                ],
              },
            ]
          : [],
      }),
    },
    organizations: {
      updateOrganization: async (id: string, changes: { name: string }) => {
        const org = fixture.remotes.find((o) => o.id === id);
        if (org) org.name = changes.name;
        return org;
      },
      getOrganizationMembershipList: async () => ({
        data: fixture.memberships,
      }),
      getOrganizationList: async () => ({
        data: fixture.remotes,
        totalCount: fixture.remotes.length,
      }),
      getOrganization: async ({ organizationId }: { organizationId: string }) =>
        fixture.remotes.find((o) => o.id === organizationId),
      createOrganization: async (input: Record<string, unknown>) => {
        fixture.createdWith.push(input);
        const remote = {
          id: `org_console_${fixture.remotes.length}`,
          name: input.name as string,
          slug: null,
          privateMetadata: input.privateMetadata as Record<string, unknown>,
        };
        fixture.remotes.push(remote);
        if (fixture.failAfterCreate) {
          fixture.failAfterCreate = false;
          throw Error("Unknown remote outcome");
        }
        return remote;
      },
      getOrganizationInvitationList: async () => ({
        data: fixture.ownerInvites,
        totalCount: fixture.ownerInvites.length,
      }),
      createOrganizationInvitation: async (input: Record<string, unknown>) => {
        const invite = {
          id: `orginv_console_${fixture.ownerInvites.length}`,
          emailAddress: input.emailAddress as string,
          status: "pending",
          expiresAt: Date.now() + 14 * 86400000,
        };
        fixture.ownerInvites.push(invite);
        return invite;
      },
    },
    invitations: {
      getInvitationList: async ({
        query,
        status,
      }: {
        query: string;
        status: string;
      }) => ({
        data: fixture.invites.filter(
          (i) =>
            (i.id === query || i.emailAddress === query) && i.status === status,
        ),
      }),
      createInvitation: async (input: Record<string, unknown>) => {
        const invite = {
          id: `inv_console_${fixture.invites.length}`,
          emailAddress: input.emailAddress as string,
          status: "pending",
          publicMetadata: input.publicMetadata as Record<string, unknown>,
          expiresAt: Date.now() + 7 * 86400000,
        };
        fixture.invites.push(invite);
        return invite;
      },
      revokeInvitation: async (id: string) => {
        const i = fixture.invites.find((i) => i.id === id);
        if (i) i.status = "revoked";
      },
    },
  }),
}));
import {
  provisionCustomer,
  reconcileInvitedOwner,
} from "../src/lib/customer-provisioning";
import {
  acceptStaffInvitation,
  inviteStaff,
  revokeStaffInvitation,
} from "../src/lib/platform-invitations";
import { loadPlatformReport, reportCsv } from "../src/lib/platform-reports";
import { loadTenants } from "../src/lib/data";
import { platformApiContext } from "../src/lib/access";
import { GET as reportsApi } from "../src/app/api/platform/reports/route";
import { POST as grantStaff } from "../src/app/api/platform/staff/route";
import { PATCH as editCustomer } from "../src/app/api/platform/tenants/[tenantId]/route";
import { PATCH as updateStaff } from "../src/app/api/platform/staff/[staffId]/route";
const input = {
  firmName: "Console Test",
  practiceType: "multi-disciplinary" as const,
  teamSize: "1-5" as const,
  region: "London" as const,
};
const invitedUser = (email: string, id = "console_invited") => ({
  id,
  firstName: "Invited",
  lastName: "Operator",
  primaryEmailAddress: {
    emailAddress: email,
    verification: { status: "verified" },
  },
});
describe.skipIf(!integrationEnabled)(
  "customer console: PostgreSQL permissions, recovery, invitations and reporting",
  () => {
    let database: TestDatabase, db: Database, adminId: string;
    beforeAll(async () => {
      database = await createTestDatabase();
      db = database.connect(database.adminUrl);
      vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl);
      vi.stubEnv("DATABASE_APP_URL", database.appUrl);
      vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fixture");
      vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_fixture");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://surveynt.test");
      vi.stubEnv("CLERK_WEBHOOK_SECRET", "whsec_fixture");
      [adminId] = (
        await db
          .insert(platformStaff)
          .values({
            clerkUserId: "console_admin",
            role: "super_admin",
            active: true,
          })
          .returning()
      ).map((s) => s.id);
    }, 120000);
    beforeEach(() => {
      fixture.session.userId = "console_admin";
      fixture.session.orgId = null;
    });
    afterAll(async () => {
      await database?.drop();
      await stopRelay();
      vi.unstubAllEnvs();
    });
    it("resolves platform access without an organisation", async () => {
      expect((await platformApiContext())?.role).toBe("super_admin");
    });
    it("recovers an unknown remote create outcome and never makes the platform operator a customer", async () => {
      fixture.failAfterCreate = true;
      await expect(
        provisionCustomer(input, { email: "owner@console.test" }, adminId),
      ).rejects.toThrow();
      const org = await provisionCustomer(
        input,
        { email: "owner@console.test" },
        adminId,
      );
      const again = await provisionCustomer(
        input,
        { email: "owner@console.test" },
        adminId,
      );
      expect(org.id).toBe(again.id);
      expect(fixture.createdWith).toHaveLength(1);
      expect(fixture.createdWith[0]).not.toHaveProperty("createdBy");
      expect(fixture.ownerInvites).toHaveLength(1);
      expect(
        await db
          .select()
          .from(organisationMemberships)
          .where(eq(organisationMemberships.organisationId, org.id)),
      ).toHaveLength(0);
      expect((await db.select().from(customerProvisioning))[0].state).toBe(
        "complete",
      );
    });
    it("reconciles a manually invited owner only after provider-confirmed membership, without waiting for a webhook", async () => {
      expect(
        await reconcileInvitedOwner({
          email: "owner@console.test",
          userId: "console_manual_owner",
        }),
      ).toBeNull();
      fixture.memberships = [
        {
          role: "org:admin",
          publicUserData: { userId: "console_manual_owner" },
        },
      ];
      const result = await reconcileInvitedOwner({
        email: "owner@console.test",
        userId: "console_manual_owner",
      });
      expect(result?.name).toBe("Console Test");
      const rows = await db
        .select()
        .from(organisationMemberships)
        .where(eq(organisationMemberships.organisationId, result!.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe("owner");
      await reconcileInvitedOwner({
        email: "owner@console.test",
        userId: "console_manual_owner",
      });
      expect(
        await db
          .select()
          .from(organisationMemberships)
          .where(eq(organisationMemberships.organisationId, result!.id)),
      ).toHaveLength(1);
    });
    it("shares provisioning with self-onboarding and assigns only its actual owner", async () => {
      const org = await provisionCustomer(
        { ...input, firmName: "Self onboard" },
        {
          email: "self@console.test",
          userId: "console_self",
          firstName: "Self",
        },
      );
      const memberships = await db
        .select()
        .from(organisationMemberships)
        .where(eq(organisationMemberships.organisationId, org.id));
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe("owner");
      expect(fixture.createdWith.at(-1)?.createdBy).toBe("console_self");
    });
    it("does not grant staff access before accepted provider invitation or to another email", async () => {
      const invite = await inviteStaff(
        "colleague@console.test",
        "support",
        adminId,
      );
      await expect(
        acceptStaffInvitation(invite.id, invitedUser("other@console.test")),
      ).rejects.toThrow();
      await expect(
        acceptStaffInvitation(invite.id, invitedUser("colleague@console.test")),
      ).rejects.toThrow();
      fixture.invites.find((i) => i.id === invite.clerkInvitationId)!.status =
        "accepted";
      await acceptStaffInvitation(
        invite.id,
        invitedUser("colleague@console.test"),
      );
      await acceptStaffInvitation(
        invite.id,
        invitedUser("colleague@console.test"),
      );
      const rows = await db
        .select()
        .from(platformStaff)
        .where(eq(platformStaff.clerkUserId, "console_invited"));
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe("support");
    });
    it("rejects revoked and expired invitations", async () => {
      const revoked = await inviteStaff(
        "revoked@console.test",
        "support",
        adminId,
      );
      await revokeStaffInvitation(revoked.id, adminId);
      await expect(
        acceptStaffInvitation(revoked.id, invitedUser(revoked.email)),
      ).rejects.toThrow();
      const expired = await inviteStaff(
        "expired@console.test",
        "support",
        adminId,
      );
      await db
        .update(platformStaffInvitations)
        .set({ expiresAt: new Date(0) })
        .where(eq(platformStaffInvitations.id, expired.id));
      await expect(
        acceptStaffInvitation(expired.id, invitedUser(expired.email)),
      ).rejects.toThrow();
    });
    it("denies tenant-role access to platform invitation and provisioning records", async () => {
      const app = database.connect(database.appUrl);
      expect(await app.select().from(platformStaffInvitations)).toHaveLength(0);
      expect(await app.select().from(customerProvisioning)).toHaveLength(0);
    });
    it("aggregates date-filtered human activity, excludes demos and produces consistent CSV", async () => {
      const [org] = await db
        .insert(organisations)
        .values({
          clerkOrganisationId: "org_report_live",
          name: "Report live",
          slug: "report-live",
          practiceType: "valuation",
          region: "London",
          status: "active",
          createdAt: new Date("2026-03-29T23:30:00Z"),
        })
        .returning();
      const [demo] = await db
        .insert(organisations)
        .values({
          clerkOrganisationId: "org_report_demo",
          name: "Report demo",
          slug: "report-demo",
          practiceType: "valuation",
          region: "London",
          status: "active",
          isDemo: true,
        })
        .returning();
      const [user] = await db
        .insert(users)
        .values({ clerkUserId: "report_user", email: "report@console.test" })
        .returning();
      await db.insert(organisationMemberships).values({
        organisationId: org.id,
        userId: user.id,
        role: "owner",
        active: true,
      });
      await db.insert(subscriptions).values({
        organisationId: org.id,
        stripeCustomerId: "cus_report",
        status: "active",
        seats: 5,
      });
      await db.insert(onboardingSteps).values([
        { organisationId: org.id, key: "one", completedAt: new Date() },
        { organisationId: org.id, key: "two" },
      ]);
      await db.insert(auditEvents).values([
        {
          organisationId: org.id,
          actorUserId: user.id,
          action: "human.in",
          resourceType: "fixture",
          occurredAt: new Date("2026-03-29T23:30:00Z"),
        },
        {
          organisationId: org.id,
          action: "automated.in",
          resourceType: "fixture",
          occurredAt: new Date("2026-03-29T23:35:00Z"),
        },
        {
          organisationId: org.id,
          actorUserId: user.id,
          action: "human.out",
          resourceType: "fixture",
          occurredAt: new Date("2026-03-30T23:00:00Z"),
        },
      ]);
      const p = new URLSearchParams(
        `period=custom&from=2026-03-30&to=2026-03-30&customer=${org.id}`,
      );
      const report = await loadPlatformReport(p, "super_admin", false);
      const directory = await loadTenants();
      expect(directory.find((c) => c.id === org.id)?.onboarding).toBe(50);
      expect(report.customers).toHaveLength(1);
      expect(report.customers[0]).toMatchObject({
        members: 1,
        seats: 5,
        steps: 2,
        completed: 1,
        user_events: 1,
      });
      expect(report.trend).toEqual([
        { day: "2026-03-30", customers: 1, jobs: 0, user_events: 1 },
      ]);
      expect(reportCsv(report)).toContain(
        '"Report live","active","active","5"',
      );
      const all = await loadPlatformReport(
        new URLSearchParams(),
        "super_admin",
        false,
      );
      expect(all.customers.some((c) => c.id === demo.id)).toBe(false);
      const withDemo = await loadPlatformReport(
        new URLSearchParams("demo=include"),
        "super_admin",
        false,
      );
      expect(withDemo.customers.some((c) => c.id === demo.id)).toBe(true);
      const ops = await loadPlatformReport(
        new URLSearchParams("view=operations"),
        "support",
        false,
      );
      expect(
        ops.customers.every((c) => c.seats === null && c.subscription === null),
      ).toBe(true);
    });
    it("enforces business-report permissions and rejects malformed filters through the API", async () => {
      fixture.session.userId = "console_invited";
      expect(
        (
          await reportsApi(
            new Request("https://surveynt.test/api/platform/reports"),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await reportsApi(
            new Request(
              "https://surveynt.test/api/platform/reports?view=operations&customer=invalid",
            ),
          )
        ).status,
      ).toBe(422);
    });
    it("protects the administrator from self-lockout", async () => {
      const response = await updateStaff(
        new Request("https://surveynt.test/api/platform/staff/x", {
          method: "PATCH",
          body: JSON.stringify({ active: false }),
        }),
        { params: Promise.resolve({ staffId: adminId }) } as never,
      );
      expect(response.status).toBe(400);
      expect(
        (
          await db
            .select()
            .from(platformStaff)
            .where(eq(platformStaff.id, adminId))
        )[0].active,
      ).toBe(true);
    });
    it("retains direct grants for verified existing accounts and rejects duplicates", async () => {
      const request = () =>
        new Request("https://surveynt.test/api/platform/staff", {
          method: "POST",
          body: JSON.stringify({
            email: "existing@console.test",
            role: "billing",
          }),
        });
      expect((await grantStaff(request())).status).toBe(200);
      expect((await grantStaff(request())).status).toBe(409);
      const [row] = await db
        .select()
        .from(platformStaff)
        .where(eq(platformStaff.clerkUserId, "console_existing"));
      expect(row.role).toBe("billing");
    });
    it("restricts customer edits and audits changes without touching other customers", async () => {
      const [target] = await db
        .select()
        .from(organisations)
        .where(eq(organisations.name, "Console Test"));
      const body = {
        name: "Console Renamed",
        tradingName: "Console Trading",
        region: "London",
        practiceType: "valuation",
        supportEmail: "support@console.test",
      };
      const request = () =>
        new Request(`https://surveynt.test/api/platform/tenants/${target.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      fixture.session.userId = "console_invited";
      expect(
        (
          await editCustomer(request(), {
            params: Promise.resolve({ tenantId: target.id }),
          })
        ).status,
      ).toBe(403);
      fixture.session.userId = "console_admin";
      expect(
        (
          await editCustomer(request(), {
            params: Promise.resolve({ tenantId: target.id }),
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await db
            .select()
            .from(organisations)
            .where(eq(organisations.id, target.id))
        )[0].name,
      ).toBe("Console Renamed");
      expect(
        await db
          .select()
          .from(organisations)
          .where(eq(organisations.name, "Self onboard")),
      ).toHaveLength(1);
    });
    it("serializes concurrent admin revocations so a final active administrator always remains", async () => {
      const [other] = await db
        .insert(platformStaff)
        .values({
          clerkUserId: "console_other_admin",
          role: "super_admin",
          active: true,
        })
        .returning();
      const request = (id: string) =>
        new Request(`https://surveynt.test/api/platform/staff/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ active: false }),
        });
      fixture.session.userId = "console_admin";
      const first = updateStaff(request(other.id), {
        params: Promise.resolve({ staffId: other.id }),
      } as never);
      fixture.session.userId = "console_other_admin";
      const second = updateStaff(request(adminId), {
        params: Promise.resolve({ staffId: adminId }),
      } as never);
      const results = await Promise.all([first, second]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const rows = await db.execute(
        sql`select count(*)::int as count from platform_staff where active and role='super_admin'`,
      );
      expect(rows.rows[0].count).toBe(1);
    });
    it("records audit evidence for management and invitation acceptance", async () => {
      const rows = await db.execute(
        sql`select distinct action from audit_events where action in ('customer.created_by_operator','platform_staff.invitation_accepted')`,
      );
      expect(rows.rows).toHaveLength(2);
    });
  },
);
