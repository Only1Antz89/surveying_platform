import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { learningPolicyVersions, platformStaff, type Database } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
import { learningActivationReadiness } from "../src/lib/learning-readiness";

const criteria = { definedBy: "Fictional reviewer panel", minimumCasesPerRelease: 40, maxContributorShare: 0.2, rareCombinationReviewBelow: 5, minimumTechnicalAgreement: 0.8, coverageDimensions: ["jurisdiction", "elementKey"], licenceScope: "Fictional licence scope for readiness testing only." };

describe.skipIf(!integrationEnabled)("shared-learning activation readiness", () => {
  let database: TestDatabase, db: Database, env: Record<string, string>;
  beforeAll(async () => {
    database = await createTestDatabase(); db = database.connect(database.adminUrl);
    env = { DATABASE_ADMIN_URL: database.adminUrl, DATABASE_APP_URL: database.appUrl };
  });
  afterAll(async () => { await database?.drop(); await stopRelay(); });
  const status = (result: Awaited<ReturnType<typeof learningActivationReadiness>>) => Object.fromEntries(result.checks.map((check) => [check.key, check.ok]));

  it("reports every unmet prerequisite on a freshly migrated database", async () => {
    const result = await learningActivationReadiness(db, env);
    expect(result.prerequisitesMet).toBe(false);
    expect(result.enabled).toBe(false);
    expect(status(result)).toEqual({ migrations: true, learning_role: false, app_role: true, lineage_secret: false, policy: false, reviewers: false, external_approvals: false });
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("rejects the application or owner role as the learning service role", async () => {
    for (const url of [database.appUrl, database.adminUrl]) expect(status(await learningActivationReadiness(db, { ...env, DATABASE_LEARNING_URL: url })).learning_role).toBe(false);
  });

  it("passes once roles, secret, published policy and three reviewers are in place", async () => {
    await db.insert(learningPolicyVersions).values({ version: "readiness-1", status: "published", summary: "Fictional policy", policyDocumentRef: "fictional-policy-doc", privacyAssessmentRef: "fictional-dpia-ref", releaseCriteria: criteria, publishedAt: new Date() });
    await db.insert(platformStaff).values([{ clerkUserId: "user_privacy", role: "privacy_reviewer" }, { clerkUserId: "user_technical", role: "technical_reviewer" }]);
    const partial = await learningActivationReadiness(db, { ...env, DATABASE_LEARNING_URL: database.learningUrl, LEARNING_LINEAGE_SECRET: "x".repeat(32) });
    expect(status(partial).reviewers).toBe(false);
    expect(partial.checks.find((check) => check.key === "reviewers")?.detail).toContain("release_manager");
    await db.insert(platformStaff).values({ clerkUserId: "user_release", role: "release_manager" });
    const ready = await learningActivationReadiness(db, { ...env, DATABASE_LEARNING_URL: database.learningUrl, LEARNING_LINEAGE_SECRET: "x".repeat(32) });
    expect(ready.prerequisitesMet).toBe(true);
    expect(ready.nextStep).toContain("SHARED_LEARNING_ENABLED=true");
    expect(JSON.stringify(ready)).not.toContain("x".repeat(32));
  });
});
