import { organisationMemberships } from "@surveynt/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { assistantTasks, clients, evidenceLinks, jobs, mediaAssets, organisations, properties, surveyFieldValues, surveys, users } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import type { SyncOperation, SyncResult } from "@surveynt/assistant";
import { applySyncOperations, createSurvey, loadSurveyPack, readSurveyMedia, storeSurveyMedia, TemplateIntegrityError, type SurveyContext } from "../src/lib/surveys";
import { createMemoryStorage, setObjectStorageForTests } from "../src/lib/storage";

const firmA = "00000000-0000-0000-0000-0000000000a3";
const firmB = "00000000-0000-0000-0000-0000000000b3";
let counter = 0;
function recordId(result: SyncResult) {
  if (result.status !== "applied" && result.status !== "duplicate") throw new Error(`Expected an applied operation, got ${result.status}`);
  return String(result.record?.id);
}
const op = () => `op_test_${Date.now().toString(36)}_${(counter += 1).toString().padStart(4, "0")}`;

describe.skipIf(!integrationEnabled)("survey capture service", () => {
  let database: TestDatabase;
  let surveyor: SurveyContext;
  let coordinator: SurveyContext;
  let otherPractitioner: SurveyContext;
  const ids: Record<string, string> = {};
  const storage = createMemoryStorage();

  beforeAll(async () => {
    database = await createTestDatabase();
    process.env.DATABASE_APP_URL = database.appUrl;
    setObjectStorageForTests(storage);
    const admin = database.connect(database.adminUrl);
    await admin.insert(organisations).values([
      { id: firmA, clerkOrganisationId: "org_a3", name: "Firm A", slug: "firm-a3", practiceType: "residential", region: "Bristol" },
      { id: firmB, clerkOrganisationId: "org_b3", name: "Firm B", slug: "firm-b3", practiceType: "residential", region: "Leeds" },
    ]);
    const [user] = await admin.insert(users).values({ clerkUserId: "user_a3", email: "surveyor@a3.test" }).returning();
    await admin.insert(organisationMemberships).values({ organisationId: firmA, userId: user.id, role: "surveyor" });
    surveyor = { organisationId: firmA, internalUserId: user.id, role: "surveyor" };
    coordinator = { organisationId: firmA, internalUserId: user.id, role: "coordinator" };
    await admin.insert(organisationMemberships).values({ organisationId: firmB, userId: user.id, role: "surveyor" });
    otherPractitioner = { organisationId: firmB, internalUserId: user.id, role: "surveyor" };
    const [clientA] = await admin.insert(clients).values({ organisationId: firmA, kind: "individual", displayName: "Client A" }).returning();
    const [clientB] = await admin.insert(clients).values({ organisationId: firmB, kind: "individual", displayName: "Client B" }).returning();
    const confirmed = { uprn: "990000000002", uprnConfirmedAt: new Date(), uprnEvidenceType: "title_documents" };
    const [flat] = await admin.insert(properties).values({ organisationId: firmA, clientId: clientA.id, line1: "Flat 2, 1 Test Terrace", city: "Bristol", postcode: "BS8 4JX", country: "ENG", ...confirmed }).returning();
    const [duplicateRecord] = await admin.insert(properties).values({ organisationId: firmA, clientId: clientA.id, line1: "Flat 2 1 Test Tce", city: "Bristol", postcode: "BS8 4JX", country: "ENG", ...confirmed }).returning();
    const [sameAddressNoUprn] = await admin.insert(properties).values({ organisationId: firmA, clientId: clientA.id, line1: "Flat 2, 1 Test Terrace", city: "Bristol", postcode: "BS8 4JX", country: "ENG" }).returning();
    const [noCountry] = await admin.insert(properties).values({ organisationId: firmA, clientId: clientA.id, line1: "9 Unknown Road", city: "Bristol", postcode: "BS1 1AA" }).returning();
    const [otherFirmFlat] = await admin.insert(properties).values({ organisationId: firmB, clientId: clientB.id, line1: "Flat 2, 1 Test Terrace", city: "Bristol", postcode: "BS8 4JX", country: "ENG", ...confirmed }).returning();
    const job = async (organisationId: string, clientId: string, propertyId: string, reference: string) => (await admin.insert(jobs).values({ organisationId, clientId, propertyId, reference, assignedSurveyorId: surveyor.internalUserId, serviceName: "Survey" }).returning())[0].id;
    ids.priorJob = await job(firmA, clientA.id, duplicateRecord.id, "A-1");
    ids.addressOnlyJob = await job(firmA, clientA.id, sameAddressNoUprn.id, "A-2");
    ids.currentJob = await job(firmA, clientA.id, flat.id, "A-3");
    ids.noCountryJob = await job(firmA, clientA.id, noCountry.id, "A-4");
    ids.otherFirmJob = await job(firmB, clientB.id, otherFirmFlat.id, "B-1");
    ids.flat = flat.id;
  }, 90_000);

  afterAll(async () => {
    setObjectStorageForTests(null);
    await database?.drop();
    await stopRelay();
  });

  async function seedPriorObservation(context: SurveyContext, jobId: string, text: string) {
    const created = await createSurvey(context, jobId, { serviceLevel: "level_2" });
    if (created.kind !== "created") throw new Error(`unexpected ${created.kind}`);
    const results = await applySyncOperations(context, created.survey.id, [{ type: "add_observation", operationId: op(), element: { sectionKey: "outside", elementKey: "roof_coverings", locationLabel: "" }, kind: "current_observation", text }]);
    expect(results[0].status).toBe("applied");
    return created.survey.id;
  }

  it("requires a jurisdiction and pins the template version and fingerprint", async () => {
    expect(await createSurvey(surveyor, ids.noCountryJob, { serviceLevel: "level_2" })).toMatchObject({ kind: "invalid" });
    const created = await createSurvey(surveyor, ids.noCountryJob, { serviceLevel: "level_2", jurisdiction: "ENG" });
    expect(created).toMatchObject({ kind: "created", survey: { templateKey: "surveynt-residential", templateVersion: "1.0.0", templateFingerprint: "9d5a4d78b06ecb0e385ce58e8619b5c048808d4a26e97c5bd2b537cdd703dce1" } });
    expect(await createSurvey(surveyor, ids.noCountryJob, { serviceLevel: "level_3" })).toMatchObject({ kind: "existing" });
  });

  it("brings in history from the same firm and confirmed UPRN only, as reminders", async () => {
    await seedPriorObservation(surveyor, ids.priorJob, "Slipped slates near the valley");
    await seedPriorObservation(surveyor, ids.addressOnlyJob, "Address-only record: should not be used");
    await seedPriorObservation(otherPractitioner, ids.otherFirmJob, "Another firm's confidential finding");
    const created = await createSurvey(surveyor, ids.currentJob, { serviceLevel: "level_2" });
    if (created.kind !== "created") throw new Error("expected a new survey");
    ids.survey = created.survey.id;
    const pack = await loadSurveyPack(surveyor, ids.survey);
    expect(pack?.tasks.map((task) => task.kind)).toEqual(["reinspect"]);
    expect(pack?.tasks[0].detail).toContain("Slipped slates");
    expect(JSON.stringify(pack)).not.toContain("confidential");
    expect(JSON.stringify(pack)).not.toContain("Address-only");
    expect(pack?.observations).toHaveLength(0);
  });

  it("applies offline operations idempotently and reports conflicts instead of overwriting", async () => {
    const first: SyncOperation = { type: "set_field", operationId: op(), fieldPath: "outside.roof_coverings.construction", value: { state: "provided", value: "Natural slate" }, baseValueId: null };
    const [applied] = await applySyncOperations(surveyor, ids.survey, [first]);
    expect(applied.status).toBe("applied");
    const valueId = recordId(applied);
    const [replayed] = await applySyncOperations(surveyor, ids.survey, [first]);
    expect(replayed).toMatchObject({ status: "duplicate", record: { id: valueId } });
    const [stale] = await applySyncOperations(surveyor, ids.survey, [{ ...first, operationId: op(), value: { state: "provided", value: "Concrete tile" } }]);
    expect(stale).toMatchObject({ status: "conflict", current: { id: valueId } });
    const [resolved] = await applySyncOperations(surveyor, ids.survey, [{ ...first, operationId: op(), value: { state: "provided", value: "Concrete tile" }, baseValueId: valueId }]);
    expect(resolved).toMatchObject({ status: "applied", record: { supersedesId: valueId } });
    const admin = database.connect(database.adminUrl);
    const history = await admin.select().from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, ids.survey), eq(surveyFieldValues.fieldPath, "outside.roof_coverings.construction")));
    expect(history).toHaveLength(2);
    expect(history.filter((row) => row.supersededAt === null)).toHaveLength(1);
  });

  it("validates against the pinned template and keeps professional judgements with surveyors", async () => {
    const results = await applySyncOperations(coordinator, ids.survey, [
      { type: "set_field", operationId: op(), fieldPath: "outside.roof_coverings.condition_rating", value: { state: "provided", value: "2" }, baseValueId: null },
      { type: "set_field", operationId: op(), fieldPath: "about.property.property_type", value: { state: "provided", value: "castle" }, baseValueId: null },
      { type: "set_field", operationId: op(), fieldPath: "outside.not_a_thing.construction", value: { state: "unknown" }, baseValueId: null },
      { type: "set_field", operationId: op(), fieldPath: "inside.roof_structure.condition_rating", value: { state: "inaccessible", reason: "No hatch" }, baseValueId: null },
      { type: "set_field", operationId: op(), fieldPath: "inspection.visit.weather", value: { state: "provided", value: "Dry, overcast" }, baseValueId: null },
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected", "rejected", "rejected", "rejected"]);
    const [rating] = await applySyncOperations(surveyor, ids.survey, [{ type: "set_field", operationId: op(), fieldPath: "inside.roof_structure.condition_rating", value: { state: "inaccessible", reason: "No hatch" }, baseValueId: null }]);
    expect(rating.status).toBe("applied");
  });

  it("versions element status and links evidence to offline-created observations", async () => {
    const element = { sectionKey: "outside", elementKey: "roof_coverings", locationLabel: "" };
    const [created] = await applySyncOperations(surveyor, ids.survey, [{ type: "set_element", operationId: op(), element, inspectionStatus: "partially_inspected", limitationReason: "Viewed from ground level", baseVersion: null }]);
    expect(created).toMatchObject({ status: "applied", record: { version: 1 } });
    const [conflict] = await applySyncOperations(surveyor, ids.survey, [{ type: "set_element", operationId: op(), element, inspectionStatus: "inspected", limitationReason: null, baseVersion: null }]);
    expect(conflict.status).toBe("conflict");
    const observationOp = op();
    const media = await storeSurveyMedia(surveyor, ids.survey, { file: new File([new Uint8Array([255, 216, 255, 224, 1, 2, 3])], "slates.jpg", { type: "image/jpeg" }), clientGeneratedId: "media_test_0001" });
    expect(media).toMatchObject({ kind: "stored", duplicate: false });
    const results = await applySyncOperations(surveyor, ids.survey, [
      { type: "add_observation", operationId: observationOp, element, kind: "current_observation", text: "Two slipped slates at the rear valley." },
      { type: "link_evidence", operationId: op(), target: { type: "observation", observationOperationId: observationOp }, evidence: { type: "media", id: "media_test_0001" } },
    ]);
    expect(results.map((result) => result.status)).toEqual(["applied", "applied"]);
    const observationId = recordId(results[0]);
    const [revised] = await applySyncOperations(surveyor, ids.survey, [{ type: "revise_observation", operationId: op(), observationId, text: "Two slipped slates at the rear valley; one cracked.", baseVersion: 1 }]);
    expect(revised.status).toBe("applied");
    const revisedId = recordId(revised);
    const admin = database.connect(database.adminUrl);
    const links = await admin.select().from(evidenceLinks).where(eq(evidenceLinks.targetId, revisedId));
    expect(links).toHaveLength(1);
    const pack = await loadSurveyPack(surveyor, ids.survey);
    expect(pack?.observations.map((item) => item.text)).toEqual(["Two slipped slates at the rear valley; one cracked."]);
  });

  it("stores media originals once and keeps them immutable and tenant-private", async () => {
    const before = storage.objects.size;
    const again = await storeSurveyMedia(surveyor, ids.survey, { file: new File([new Uint8Array([1])], "retry.jpg", { type: "image/jpeg" }), clientGeneratedId: "media_test_0001" });
    expect(again).toMatchObject({ kind: "stored", duplicate: true });
    expect(storage.objects.size).toBe(before);
    expect(await storeSurveyMedia(surveyor, ids.survey, { file: new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }), clientGeneratedId: "media_test_0002" })).toMatchObject({ kind: "invalid" });
    const admin = database.connect(database.adminUrl);
    const [stored] = await admin.select().from(mediaAssets).where(eq(mediaAssets.clientGeneratedId, "media_test_0001"));
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(admin.update(mediaAssets).set({ storageKey: "swapped" }).where(eq(mediaAssets.id, stored.id))).rejects.toThrow();
    await expect(admin.update(surveyFieldValues).set({ value: { state: "unknown" } }).where(eq(surveyFieldValues.surveyId, ids.survey))).rejects.toThrow();
    expect(await readSurveyMedia({ organisationId: firmB }, stored.id)).toBeNull();
    expect(await readSurveyMedia(surveyor, stored.id)).not.toBeNull();
  });

  it("refuses another firm's survey and stops capture when the pinned template changes", async () => {
    const [foreign] = await applySyncOperations(otherPractitioner, ids.survey, [{ type: "set_field", operationId: op(), fieldPath: "inspection.visit.weather", value: { state: "provided", value: "Hijack" }, baseValueId: null }]);
    expect(foreign).toMatchObject({ status: "rejected", message: "Survey not found." });
    expect(await loadSurveyPack({ organisationId: firmB }, ids.survey)).toBeNull();
    const admin = database.connect(database.adminUrl);
    await admin.update(surveys).set({ templateFingerprint: "0".repeat(64) }).where(eq(surveys.id, ids.survey));
    await expect(loadSurveyPack(surveyor, ids.survey)).rejects.toBeInstanceOf(TemplateIntegrityError);
    const tasks = await admin.select().from(assistantTasks).where(sql`${assistantTasks.surveyId} = ${ids.survey}`);
    expect(tasks.length).toBeGreaterThan(0);
  });
});
