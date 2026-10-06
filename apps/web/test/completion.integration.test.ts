import { organisationMemberships } from "@surveynt/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { auditEvents, clients, completionOverrides, createDatabase, jobs, organisations, properties, users, withTenant } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { isFieldRequired, listFields, residentialTemplateV1, type FieldDefinition, type FieldValue, type SyncOperation, type SyncResult } from "@surveynt/assistant";
import type { JobStage } from "@surveynt/domain";
import { enforceStageGate } from "../src/lib/completion";
import { applySyncOperations, createSurvey, storeSurveyMedia, type SurveyContext } from "../src/lib/surveys";
import { createMemoryStorage, setObjectStorageForTests } from "../src/lib/storage";

const firmA = "00000000-0000-0000-0000-0000000000a7";
const firmB = "00000000-0000-0000-0000-0000000000b7";
let counter = 0;
const op = () => `op_gate_${(counter += 1).toString().padStart(6, "0")}`;

function sample(field: FieldDefinition): FieldValue {
  switch (field.type) {
    case "enum": return { state: "provided", value: field.key === "listed_status" || field.key === "conservation_area" ? "no_record_found" : field.options![0].value };
    case "integer": case "decimal": return { state: "provided", value: field.min ?? 1 };
    case "boolean": return { state: "provided", value: false };
    case "date": return { state: "provided", value: "2026-09-28" };
    default: return { state: "provided", value: "Recorded on site." };
  }
}

/** A minimal complete condition-report scope survey: every building element not applicable, every "always" field answered. */
function completingOperations(): SyncOperation[] {
  const operations: SyncOperation[] = [];
  for (const section of residentialTemplateV1.sections) for (const element of section.elements) {
    if (element.inspectable) operations.push({ type: "set_element", operationId: op(), element: { sectionKey: section.key, elementKey: element.key, locationLabel: "" }, inspectionStatus: "not_applicable", limitationReason: null, baseVersion: null });
  }
  for (const resolved of listFields(residentialTemplateV1)) {
    if (!resolved.element.inspectable && isFieldRequired(resolved.field, { serviceLevel: "level_1" })) operations.push({ type: "set_field", operationId: op(), fieldPath: resolved.path, value: sample(resolved.field), baseValueId: null });
  }
  return operations;
}

const applied = (results: SyncResult[]) => results.filter((result) => result.status !== "applied" && result.status !== "duplicate");

describe.skipIf(!integrationEnabled)("completion checks and the stage gate", () => {
  let database: TestDatabase;
  let surveyor: SurveyContext;
  let coordinator: SurveyContext;
  let jobId = "";
  let surveyId = "";
  let jobWithoutSurvey = "";

  const gate = (context: SurveyContext, targetStage: JobStage, overrides: { itemId: string; reason: string; note?: string }[] = [], forJob = jobId) =>
    withTenant(createDatabase(), context.organisationId, (tx) => enforceStageGate(tx, context, { jobId: forJob, targetStage, overrides }));

  beforeAll(async () => {
    database = await createTestDatabase();
    process.env.DATABASE_APP_URL = database.appUrl;
    setObjectStorageForTests(createMemoryStorage());
    const admin = database.connect(database.adminUrl);
    await admin.insert(organisations).values([
      { id: firmA, clerkOrganisationId: "org_a7", name: "Firm A", slug: "firm-a7", practiceType: "residential", region: "Bristol" },
      { id: firmB, clerkOrganisationId: "org_b7", name: "Firm B", slug: "firm-b7", practiceType: "residential", region: "Leeds" },
    ]);
    const [user] = await admin.insert(users).values({ clerkUserId: "user_a7", email: "surveyor@a7.test" }).returning();
    await admin.insert(organisationMemberships).values({ organisationId: firmA, userId: user.id, role: "surveyor", canApproveReports: true });
    surveyor = { organisationId: firmA, internalUserId: user.id, role: "surveyor", canApproveReports: true };
    coordinator = { organisationId: firmA, internalUserId: user.id, role: "coordinator" };
    const [client] = await admin.insert(clients).values({ organisationId: firmA, kind: "individual", displayName: "Client A" }).returning();
    const [property] = await admin.insert(properties).values({ organisationId: firmA, clientId: client.id, line1: "1 Gate Road", city: "Bristol", postcode: "BS1 1AA", country: "ENG" }).returning();
    [{ id: jobId }, { id: jobWithoutSurvey }] = await admin.insert(jobs).values([
      { organisationId: firmA, clientId: client.id, propertyId: property.id, reference: "G-1", assignedSurveyorId: surveyor.internalUserId, serviceName: "Condition report", stage: "inspection_complete" },
      { organisationId: firmA, clientId: client.id, propertyId: property.id, reference: "G-2", assignedSurveyorId: surveyor.internalUserId, serviceName: "Legacy job", stage: "report_drafting" },
    ]).returning();
    const created = await createSurvey(surveyor, jobId, { serviceLevel: "level_1" });
    if (created.kind !== "created") throw new Error(`unexpected ${created.kind}`);
    surveyId = created.survey.id;
  }, 90_000);

  afterAll(async () => {
    setObjectStorageForTests(null);
    await database?.drop();
    await stopRelay();
  });

  it("does not gate other stages or jobs without a survey", async () => {
    expect(await gate(surveyor, "report_drafting")).toEqual({ kind: "not_gated" });
    expect(await gate(surveyor, "internal_review", [], jobWithoutSurvey)).toEqual({ kind: "not_gated" });
  });

  it("blocks an incomplete survey and passes once the checklist is complete", async () => {
    const blocked = await gate(surveyor, "internal_review");
    expect(blocked.kind).toBe("blocked");
    if (blocked.kind !== "blocked") return;
    expect(blocked.check.unresolved.length).toBeGreaterThan(30);
    expect(blocked.check.unresolved.map((item) => item.id)).toContain("status:outside.roof_coverings");
    expect(applied(await applySyncOperations(surveyor, surveyId, completingOperations()))).toEqual([]);
    expect(await gate(surveyor, "internal_review")).toMatchObject({ kind: "passed", overridden: 0, report: { ready: true } });
  });

  it("requires a surveyor role and a permitted reason to override, and keeps the override immutable", async () => {
    const values = await applySyncOperations(surveyor, surveyId, [{ type: "set_field", operationId: op(), fieldPath: "about.property.extensions_present", value: { state: "provided", value: true }, baseValueId: null }]);
    // The field already has a value, so a first-value edit conflicts; take the current id and retry as an edit.
    const current = values[0].status === "conflict" ? (values[0].current?.id as string) : null;
    expect(applied(await applySyncOperations(surveyor, surveyId, [{ type: "set_field", operationId: op(), fieldPath: "about.property.extensions_present", value: { state: "provided", value: true }, baseValueId: current }]))).toEqual([]);
    const reason = { itemId: "rule:EXTENSION-APPROVALS:survey", reason: "Alterations predate any approval requirement" };
    expect(await gate(coordinator, "internal_review", [reason])).toMatchObject({ kind: "blocked", mayOverride: false });
    expect(await gate(surveyor, "internal_review", [{ ...reason, reason: "Because I said so" }])).toMatchObject({ kind: "blocked", check: { invalid: [{ itemId: reason.itemId }] } });
    // Issuing also needs a signed-off report version (A5); without one, a recorded reason is required.
    expect(await gate(surveyor, "issued", [reason])).toMatchObject({ kind: "blocked", check: { unresolved: [{ id: "report:approved" }] } });
    expect(await gate(surveyor, "issued", [reason, { itemId: "report:approved", reason: "Report produced and signed off outside Surveynt" }])).toMatchObject({ kind: "passed", overridden: 2 });
    const admin = database.connect(database.adminUrl);
    const rows = await admin.select().from(completionOverrides).where(eq(completionOverrides.surveyId, surveyId));
    expect(rows).toMatchObject([{ itemId: reason.itemId, ruleId: "EXTENSION-APPROVALS", ruleSetVersion: "1.0.0", templateVersion: "1.0.0", targetStage: "issued", overriddenByUserId: surveyor.internalUserId }, { itemId: "report:approved", category: "report_approval", targetStage: "issued" }]);
    expect(await admin.select().from(auditEvents).where(eq(auditEvents.action, "survey.completion_overridden"))).toHaveLength(1);
    await expect(admin.update(completionOverrides).set({ reason: "edited" }).where(eq(completionOverrides.surveyId, surveyId))).rejects.toThrow();
    const otherFirm = await withTenant(createDatabase(), firmB, (tx) => tx.select().from(completionOverrides));
    expect(otherFirm).toHaveLength(0);
  });

  it("lets only surveyors classify defects, and gates a defect until it has evidence", async () => {
    const element = { sectionKey: "outside", elementKey: "roof_coverings", locationLabel: "Rear slope" };
    const refused = await applySyncOperations(coordinator, surveyId, [{ type: "add_observation", operationId: op(), element, kind: "current_observation", text: "Slipped slates.", defect: { nextAction: "repair" } }]);
    expect(refused[0]).toMatchObject({ status: "rejected", message: expect.stringMatching(/Professional survey recording permission/) });
    const [added] = await applySyncOperations(surveyor, surveyId, [{ type: "add_observation", operationId: op(), element, kind: "current_observation", text: "Slipped slates.", defect: { nextAction: "repair" } }]);
    if (added.status !== "applied") throw new Error(added.status);
    const observationId = String(added.record?.id);
    const blocked = await gate(surveyor, "internal_review", [{ itemId: "rule:EXTENSION-APPROVALS:survey", reason: "Alterations predate any approval requirement" }]);
    expect(blocked).toMatchObject({ kind: "blocked", check: { unresolved: [{ id: `rule:DEFECT-DETAIL:${observationId}` }] } });
    const media = await storeSurveyMedia(surveyor, surveyId, { file: new File([new Uint8Array([255, 216, 255, 224, 1])], "slates.jpg", { type: "image/jpeg" }), clientGeneratedId: "media_gate_0001" });
    if (media.kind !== "stored") throw new Error(media.kind);
    expect(applied(await applySyncOperations(surveyor, surveyId, [{ type: "link_evidence", operationId: op(), target: { type: "observation", observationId }, evidence: { type: "media", id: "media_gate_0001" } }]))).toEqual([]);
    expect(await gate(surveyor, "internal_review", [{ itemId: "rule:EXTENSION-APPROVALS:survey", reason: "Alterations predate any approval requirement" }])).toMatchObject({ kind: "passed", overridden: 1 });
    const count = await database.connect(database.adminUrl).execute(sql`select count(*)::int as count from completion_overrides`);
    expect((count as unknown as { rows: { count: number }[] }).rows[0].count).toBe(3);
  });
});
