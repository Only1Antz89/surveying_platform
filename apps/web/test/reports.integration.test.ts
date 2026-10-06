import { organisationMemberships } from "@surveynt/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { clients, createDatabase, jobs, organisations, properties, reportApprovals, reportVersions, users, withTenant, wordingClauses } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { isFieldRequired, listFields, residentialTemplateV1, type FieldDefinition, type FieldValue, type SyncOperation } from "@surveynt/assistant";
import { enforceStageGate } from "../src/lib/completion";
import { approveReportVersion, composeSurveyReport, loadSurveyReports, reopenSurvey } from "../src/lib/reports";
import { applySyncOperations, createSurvey, loadSurveyPack, type SurveyContext } from "../src/lib/surveys";
import { approveWording, createWordingDraft, retireWording, WordingError, type ClauseInput } from "../src/lib/wording";

const firmA = "00000000-0000-0000-0000-0000000000aa";
const firmB = "00000000-0000-0000-0000-0000000000ba";
let counter = 0;
const op = () => `op_report_${(counter += 1).toString().padStart(6, "0")}`;

function sample(field: FieldDefinition): FieldValue {
  switch (field.type) {
    case "enum": return { state: "provided", value: field.key === "listed_status" || field.key === "conservation_area" ? "no_record_found" : field.options![0].value };
    case "integer": case "decimal": return { state: "provided", value: field.min ?? 1 };
    case "boolean": return { state: "provided", value: false };
    case "date": return { state: "provided", value: "2026-09-28" };
    default: return { state: "provided", value: `Recorded ${field.key.replace(/_/g, " ")}.` };
  }
}

/** A complete condition-report scope survey: roof coverings inspected and rated 2, every other building element not applicable. */
function completingOperations(): SyncOperation[] {
  const operations: SyncOperation[] = [];
  for (const section of residentialTemplateV1.sections) for (const element of section.elements) {
    if (!element.inspectable) continue;
    const roof = section.key === "outside" && element.key === "roof_coverings";
    operations.push({ type: "set_element", operationId: op(), element: { sectionKey: section.key, elementKey: element.key, locationLabel: "" }, inspectionStatus: roof ? "inspected" : "not_applicable", limitationReason: null, baseVersion: null });
  }
  for (const resolved of listFields(residentialTemplateV1)) {
    if (!resolved.element.inspectable && isFieldRequired(resolved.field, { serviceLevel: "level_1" })) operations.push({ type: "set_field", operationId: op(), fieldPath: resolved.path, value: sample(resolved.field), baseValueId: null });
  }
  operations.push({ type: "set_field", operationId: op(), fieldPath: "outside.roof_coverings.condition_rating", value: { state: "provided", value: "2" }, baseValueId: null });
  operations.push({ type: "set_field", operationId: op(), fieldPath: "outside.roof_coverings.construction", value: { state: "provided", value: "Pitched roof with natural slate." }, baseValueId: null });
  return operations;
}

const clauseInput = (overrides: Partial<ClauseInput> = {}): ClauseInput => ({ clauseKey: "roof.repair", purpose: "element_narrative", title: "Roof repair", body: "Repairs to the {element} should be arranged.", elementKey: "outside.roof_coverings", conditionRatings: ["2"], nextActions: [], inspectionStatuses: [], jurisdictions: [], serviceLevels: [], source: "firm_authored", licenceReference: null, ...overrides });

describe.skipIf(!integrationEnabled)("wording library and report assembly", () => {
  let database: TestDatabase;
  let owner: SurveyContext;
  let surveyor: SurveyContext;
  let coordinator: SurveyContext;
  let jobId = "";
  let surveyId = "";
  let firstVersionId = "";

  beforeAll(async () => {
    database = await createTestDatabase();
    Object.assign(process.env, { DATABASE_APP_URL: database.appUrl, DATABASE_ADMIN_URL: database.adminUrl });
    const admin = database.connect(database.adminUrl);
    await admin.insert(organisations).values([
      { id: firmA, clerkOrganisationId: "org_aa", name: "Firm A", slug: "firm-aa", practiceType: "residential", region: "Bristol" },
      { id: firmB, clerkOrganisationId: "org_ba", name: "Firm B", slug: "firm-ba", practiceType: "residential", region: "Leeds" },
    ]);
    const [ownerUser, surveyorUser] = await admin.insert(users).values([{ clerkUserId: "user_aa_owner", email: "owner@aa.test" }, { clerkUserId: "user_aa_surveyor", email: "surveyor@aa.test" }]).returning();
    await admin.insert(organisationMemberships).values([{ organisationId: firmA, userId: ownerUser.id, role: "owner", canRecordSurvey: true, canApproveReports: true }, { organisationId: firmA, userId: surveyorUser.id, role: "surveyor" }]);
    owner = { organisationId: firmA, internalUserId: ownerUser.id, role: "owner", canRecordSurvey: true, canApproveReports: true };
    surveyor = { organisationId: firmA, internalUserId: surveyorUser.id, role: "surveyor" };
    coordinator = { organisationId: firmA, internalUserId: surveyorUser.id, role: "coordinator" };
    const [client] = await admin.insert(clients).values({ organisationId: firmA, kind: "individual", displayName: "Client A" }).returning();
    const [property] = await admin.insert(properties).values({ organisationId: firmA, clientId: client.id, line1: "5 Report Street", city: "Bristol", postcode: "BS3 3CC", country: "ENG" }).returning();
    [{ id: jobId }] = await admin.insert(jobs).values({ organisationId: firmA, clientId: client.id, propertyId: property.id, reference: "R-1", assignedSurveyorId: surveyor.internalUserId, serviceName: "Condition report", stage: "internal_review" }).returning();
    const created = await createSurvey(surveyor, jobId, { serviceLevel: "level_1" });
    if (created.kind !== "created") throw new Error(created.kind);
    surveyId = created.survey.id;
    const results = await applySyncOperations(surveyor, surveyId, completingOperations());
    expect(results.filter((result) => result.status !== "applied")).toEqual([]);
  }, 90_000);

  afterAll(async () => {
    await database?.drop();
    await stopRelay();
  });

  it("keeps approved wording immutable, versioned and approvable only by owners and administrators", async () => {
    const draft = await createWordingDraft(surveyor, clauseInput());
    await expect(approveWording(surveyor, draft.id)).rejects.toThrow(WordingError);
    const v1 = await approveWording(owner, draft.id);
    expect(v1).toMatchObject({ status: "approved", version: 1 });
    await expect(createWordingDraft(surveyor, clauseInput())).resolves.toMatchObject({ version: 2, status: "draft" });
    await expect(createWordingDraft(surveyor, clauseInput())).rejects.toThrow(/already has a draft/);
    const admin = database.connect(database.adminUrl);
    await expect(admin.update(wordingClauses).set({ body: "Changed after approval." }).where(eq(wordingClauses.id, v1.id))).rejects.toThrow();
    await expect(admin.delete(wordingClauses).where(eq(wordingClauses.id, v1.id))).rejects.toThrow();
    await expect(admin.insert(wordingClauses).values({ organisationId: firmA, clauseKey: "licensed.no-ref", version: 1, purpose: "summary", title: "Licensed", body: "Licensed text body.", source: "licensed_third_party" })).rejects.toThrow();
    const limitation = await createWordingDraft(surveyor, clauseInput({ clauseKey: "limitation.any", purpose: "limitation", title: "Not inspected", body: "We did not inspect the {element}.", elementKey: null, conditionRatings: [], inspectionStatuses: ["inaccessible"] }));
    await retireWording(surveyor, limitation.id);
    expect(await withTenant(createDatabase(), firmA, (tx) => tx.select().from(wordingClauses).where(eq(wordingClauses.clauseKey, "limitation.any")))).toHaveLength(0);
    expect(await withTenant(createDatabase(), firmB, (tx) => tx.select().from(wordingClauses))).toHaveLength(0);
  });

  it("composes a traced, immutable version from approved wording and recorded findings only", async () => {
    const composed = await composeSurveyReport(surveyor, surveyId);
    firstVersionId = composed.id;
    const roof = composed.content.sections.find((section) => section.key === "outside")!.elements.find((element) => element.key === "outside.roof_coverings")!;
    expect(roof.blocks.map((block) => block.text)).toEqual(["Condition rating: 2 — repair or replacement needed, not considered serious or urgent", "Pitched roof with natural slate.", "Repairs to the roof coverings should be arranged."]);
    // The v2 draft is not approved, so only v1 wording is used.
    expect(JSON.stringify(composed.content)).not.toMatch(/Changed after approval/);
    const [row] = await database.connect(database.adminUrl).select().from(reportVersions).where(eq(reportVersions.id, composed.id));
    expect(row).toMatchObject({ versionNumber: 1, composer: "deterministic-composer-v1", templateVersion: "1.0.0", trace: { clauses: [{ clauseKey: "roof.repair", version: 1 }] } });
    await expect(database.connect(database.adminUrl).update(reportVersions).set({ composer: "edited" }).where(eq(reportVersions.id, composed.id))).rejects.toThrow();
  });

  it("requires a surveyor's explicit sign-off of the latest unchanged version, then closes capture", async () => {
    await expect(approveReportVersion(surveyor, surveyId, firstVersionId, { confirm: true })).rejects.toMatchObject({ status: 403 });
    await database.connect(database.adminUrl).update(organisationMemberships).set({ canApproveReports: true }).where(eq(organisationMemberships.userId, surveyor.internalUserId!));
    surveyor.canApproveReports = true;
    await expect(approveReportVersion(coordinator, surveyId, firstVersionId, { confirm: true })).rejects.toMatchObject({ status: 403 });
    await expect(approveReportVersion(surveyor, surveyId, firstVersionId, { confirm: false })).rejects.toMatchObject({ code: "confirmation_required" });
    // A change after composing makes the version out of date.
    const pack = await loadSurveyPack(surveyor, surveyId);
    const construction = pack!.values.find((value) => value.fieldPath === "outside.roof_coverings.construction")!;
    await applySyncOperations(surveyor, surveyId, [{ type: "set_field", operationId: op(), fieldPath: "outside.roof_coverings.construction", value: { state: "provided", value: "Pitched roof with natural slate and lead valleys." }, baseValueId: construction.id }]);
    await expect(approveReportVersion(surveyor, surveyId, firstVersionId, { confirm: true })).rejects.toMatchObject({ code: "out_of_date" });
    const second = await composeSurveyReport(surveyor, surveyId);
    await expect(approveReportVersion(surveyor, surveyId, firstVersionId, { confirm: true })).rejects.toMatchObject({ code: "not_latest" });
    expect(await approveReportVersion(surveyor, surveyId, second.id, { confirm: true, note: "Reviewed on screen." })).toMatchObject({ versionNumber: 2 });
    const state = await loadSurveyReports(surveyor, surveyId);
    expect(state).toMatchObject({ surveyStatus: "approved", versions: [{ versionNumber: 2, current: true, approval: { approverRole: "surveyor" } }, { versionNumber: 1, current: false, approval: null }] });
    const blocked = await applySyncOperations(surveyor, surveyId, [{ type: "add_observation", operationId: op(), element: { sectionKey: "outside", elementKey: "roof_coverings", locationLabel: "" }, kind: "current_observation", text: "Late addition." }]);
    expect(blocked[0].status).toBe("rejected");
    await expect(database.connect(database.adminUrl).delete(reportApprovals).where(sql`true`)).rejects.toThrow();
  });

  it("issues only with a current signed-off version, and reopening invalidates it until signed off again", async () => {
    const gate = (stage: "issued") => withTenant(createDatabase(), firmA, (tx) => enforceStageGate(tx, surveyor, { jobId, targetStage: stage, overrides: [] }));
    expect(await gate("issued")).toMatchObject({ kind: "passed", overridden: 0 });
    await expect(reopenSurvey(surveyor, surveyId, "short")).resolves.toMatchObject({ status: "in_progress" });
    const pack = await loadSurveyPack(surveyor, surveyId);
    const construction = pack!.values.find((value) => value.fieldPath === "outside.roof_coverings.construction")!;
    await applySyncOperations(surveyor, surveyId, [{ type: "set_field", operationId: op(), fieldPath: "outside.roof_coverings.construction", value: { state: "provided", value: "Pitched slate roof." }, baseValueId: construction.id }]);
    expect(await gate("issued")).toMatchObject({ kind: "blocked", check: { unresolved: [{ id: "report:approved", detail: expect.stringMatching(/changed after sign-off/) }] } });
    expect(await loadSurveyReports({ organisationId: firmB }, surveyId)).toBeNull();
  });
});
