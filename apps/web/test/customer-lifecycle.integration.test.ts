import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import {
  createTestDatabase,
  integrationEnabled,
  stopRelay,
  type TestDatabase,
} from "@surveynt/db/testing";
import {
  auditEvents,
  organisations,
  organisationMemberships,
  onboardingSteps,
  platformStaff,
  subscriptions,
  users,
  withTenant,
  type Database,
} from "@surveynt/db";
vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({ userId: "lifecycle_admin" }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ ...session }) }));
import {
  createFollowup,
  completeFollowup,
  recordPracticeVisit,
  recordWorkspaceVisit,
} from "../src/lib/customer-followups";
import {
  loadLifecycleData,
  filterLifecycleData,
  lifecycleCsv,
} from "../src/lib/customer-lifecycle-data";
import { POST, GET } from "../src/app/api/platform/engagement/route";
describe.skipIf(!integrationEnabled)(
  "customer lifecycle persistence and isolation",
  () => {
    let database: TestDatabase,
      db: Database,
      customerId: string,
      demoId: string,
      staffId: string,
      ownerId: string,
      prospectId: string;
    beforeAll(async () => {
      database = await createTestDatabase();
      db = database.connect(database.adminUrl);
      vi.stubEnv("DATABASE_ADMIN_URL", database.adminUrl);
      vi.stubEnv("DATABASE_APP_URL", database.appUrl);
      vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fixture");
      vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_fixture");
      [staffId] = (
        await db
          .insert(platformStaff)
          .values({ clerkUserId: "lifecycle_admin", role: "super_admin" })
          .returning()
      ).map((x) => x.id);
      const orgs = await db
        .insert(organisations)
        .values([
          {
            clerkOrganisationId: "org_lifecycle",
            name: "Lifecycle Customer",
            slug: "lifecycle",
            practiceType: "valuation",
            region: "London",
          },
          {
            clerkOrganisationId: "org_demo_lifecycle",
            name: "Demo Customer",
            slug: "lifecycle-demo",
            practiceType: "valuation",
            region: "London",
            isDemo: true,
          },
        ])
        .returning();
      customerId = orgs[0].id;
      demoId = orgs[1].id;
      [ownerId] = (
        await db
          .insert(users)
          .values({
            clerkUserId: "lifecycle_owner",
            email: "owner@lifecycle.test",
          })
          .returning()
      ).map((u) => u.id);
      await db
        .insert(organisationMemberships)
        .values({ organisationId: customerId, userId: ownerId, role: "owner" });
      await db.insert(onboardingSteps).values([
        {
          organisationId: customerId,
          key: "practice_details",
          completedAt: new Date(),
        },
        { organisationId: customerId, key: "billing" },
      ]);
      await db.insert(subscriptions).values({
        organisationId: customerId,
        stripeCustomerId: "cus_lifecycle",
        status: "trialing",
        trialEndsAt: new Date(Date.now() + 2 * 86400000),
      });
    }, 120000);
    afterAll(async () => {
      await database?.drop();
      await stopRelay();
      vi.unstubAllEnvs();
    });
    const operator = () => ({ role: "super_admin", platformStaffId: staffId });
    const task = (targetId = customerId) => ({
      requestId: crypto.randomUUID(),
      targetType: "customer" as const,
      targetId,
      assigneeId: staffId,
      kind: "onboarding" as const,
      dueDate: "2026-10-29",
      note: "Help finish account setup",
    });
    it("records a verified setup visitor once per London day and excludes staff", async () => {
      const user = {
        id: "lifecycle_prospect",
        firstName: "Lead",
        lastName: null,
        primaryEmailAddress: {
          emailAddress: "lead@lifecycle.test",
          verification: { status: "verified" },
        },
      };
      await Promise.all([recordPracticeVisit(user), recordPracticeVisit(user)]);
      await recordPracticeVisit({ ...user, id: "lifecycle_admin" });
      await recordPracticeVisit({
        ...user,
        id: "unverified",
        primaryEmailAddress: {
          ...user.primaryEmailAddress,
          verification: { status: "unverified" },
        },
      });
      const data = await loadLifecycleData(false);
      expect(data.prospects).toHaveLength(1);
      prospectId = data.prospects[0].id;
      expect(
        await db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.action, "customer.practice_form_viewed")),
      ).toHaveLength(1);
    });
    it("creates prospect follow-ups only for eligible authenticated setup visitors", async () => {
      await expect(
        createFollowup(
          { ...task(prospectId), targetType: "prospect" },
          operator(),
        ),
      ).resolves.toHaveProperty("id");
      await expect(
        createFollowup(
          { ...task(ownerId), targetType: "prospect" },
          operator(),
        ),
      ).rejects.toThrow("Eligible prospect not found");
    });
    it("deduplicates concurrent retries and rejects changed request bodies", async () => {
      const input = task();
      const results = await Promise.all([
        createFollowup(input, operator()),
        createFollowup(input, operator()),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(
        await db
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.resourceId, input.requestId),
              eq(auditEvents.action, "platform.engagement.followup_created"),
            ),
          ),
      ).toHaveLength(1);
      await expect(
        createFollowup({ ...input, note: "A different action" }, operator()),
      ).rejects.toThrow("already been used");
    });
    it("retains immutable outcomes and prevents concurrent duplicate completion", async () => {
      const input = task();
      await createFollowup(input, operator());
      const results = await Promise.allSettled([
        completeFollowup(
          input.requestId,
          { outcome: "progressed", note: "Owner completed setup" },
          operator(),
        ),
        completeFollowup(
          input.requestId,
          { outcome: "contacted", note: "Spoke to the owner" },
          operator(),
        ),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.resourceId, input.requestId));
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.organisationId === null)).toBe(true);
    });
    it("hides internal engagement notes from the customer runtime role", async () => {
      const input = task();
      await createFollowup(input, operator());
      const app = database.connect(database.appUrl);
      const rows = await withTenant(app, customerId, (tx) =>
        tx
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.resourceId, input.requestId)),
      );
      expect(rows).toHaveLength(0);
      const other = await withTenant(app, demoId, (tx) =>
        tx
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.resourceId, input.requestId)),
      );
      expect(other).toHaveLength(0);
    });
    it("enforces API roles and rejects customers and unauthenticated callers", async () => {
      session.userId = "lifecycle_owner";
      expect(
        (
          await GET(
            new Request("https://surveynt.test/api/platform/engagement"),
          )
        ).status,
      ).toBe(401);
      session.userId = "unknown";
      expect(
        (
          await GET(
            new Request("https://surveynt.test/api/platform/engagement"),
          )
        ).status,
      ).toBe(401);
      await db
        .insert(platformStaff)
        .values({ clerkUserId: "lifecycle_compliance", role: "compliance" });
      session.userId = "lifecycle_compliance";
      expect(
        (
          await GET(
            new Request("https://surveynt.test/api/platform/engagement"),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await POST(
            new Request("https://surveynt.test/api/platform/engagement", {
              method: "POST",
            }),
          )
        ).status,
      ).toBe(403);
      session.userId = "lifecycle_admin";
      await expect(
        createFollowup(task(), { ...operator(), role: "owner" }),
      ).rejects.toThrow("access required");
    });
    it("rejects inactive assignees and missing targets", async () => {
      const [inactive] = await db
        .insert(platformStaff)
        .values({
          clerkUserId: "inactive_staff",
          role: "support",
          active: false,
        })
        .returning();
      await expect(
        createFollowup({ ...task(), assigneeId: inactive.id }, operator()),
      ).rejects.toThrow("active engagement");
      await expect(
        createFollowup(task(crypto.randomUUID()), operator()),
      ).rejects.toThrow("Customer not found");
    });
    it("uses member activity, excludes platform activity, demos and nonmatching CSV rows", async () => {
      await db.insert(auditEvents).values([
        {
          organisationId: customerId,
          actorUserId: ownerId,
          action: "job.viewed",
          resourceType: "job",
          occurredAt: new Date("2026-10-20T12:00:00Z"),
        },
        {
          organisationId: customerId,
          platformStaffId: staffId,
          action: "tenant.updated",
          resourceType: "organisation",
          occurredAt: new Date("2026-10-28T12:00:00Z"),
        },
      ]);
      const data = await loadLifecycleData(false);
      expect(data.accounts).toHaveLength(1);
      expect(data.accounts[0].last_activity).toContain("2026-10-20");
      expect(data.accounts[0].steps).toHaveLength(2);
      expect((await loadLifecycleData(true)).accounts).toHaveLength(2);
      const filtered = filterLifecycleData(
        data,
        new URLSearchParams({ q: "does-not-exist" }),
      );
      expect(filtered.accounts).toHaveLength(0);
      expect(filtered.followups).toHaveLength(0);
      expect(lifecycleCsv(filtered)).not.toContain("Lifecycle Customer");
      expect(lifecycleCsv(data)).toContain("Lifecycle Customer");
    });
    it("removes a prospect from the setup queue after joining a customer", async () => {
      await db.insert(organisationMemberships).values({
        organisationId: customerId,
        userId: prospectId,
        role: "administrator",
      });
      expect((await loadLifecycleData(false)).prospects).toHaveLength(0);
    });
    it("measures daily workspace visits without counting internal staff as customer activity", async () => {
      const context = {
        organisationId: customerId,
        internalUserId: ownerId,
        userId: "lifecycle_owner",
      };
      await Promise.all([
        recordWorkspaceVisit(context),
        recordWorkspaceVisit(context),
      ]);
      await recordWorkspaceVisit({ ...context, userId: "lifecycle_admin" });
      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "customer.workspace_visited"));
      expect(events).toHaveLength(1);
      expect(events[0].actorUserId).toBe(ownerId);
    });
    it("ignores tenant-authored lookalikes of internal engagement records", async () => {
      const id = crypto.randomUUID();
      await db.insert(auditEvents).values({
        organisationId: customerId,
        actorUserId: ownerId,
        action: "platform.engagement.followup_created",
        resourceType: "customer_followup",
        resourceId: id,
        metadata: {
          targetType: "customer",
          targetId: customerId,
          note: "forged entry",
        },
      });
      expect(
        (await loadLifecycleData(false)).followups.some((f) => f.id === id),
      ).toBe(false);
      await expect(
        completeFollowup(
          id,
          { outcome: "contacted", note: "Should never complete" },
          operator(),
        ),
      ).rejects.toThrow("Follow-up not found");
    });
  },
);
