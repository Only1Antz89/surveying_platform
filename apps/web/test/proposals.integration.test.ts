import { organisationMemberships } from "@surveynt/db";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { assistantTasks, clients, referenceDataSources, evidenceLinks, fieldProposals, jobs, organisations, properties, surveyFieldValues, users } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
import { importSpatialLayer, syncSourceRegistry } from "@surveynt/property-data/importers";
import { intelligenceProviders, legacyEpcProvider } from "@surveynt/property-data";
import { processIntelligenceRun, requestIntelligenceRefresh } from "../src/lib/intelligence";
import { listSurveyProposals, refreshSurveyProposals, reviewProposal } from "../src/lib/proposals";
import { applySyncOperations, createSurvey, type SurveyContext } from "../src/lib/surveys";

const firmA = "00000000-0000-0000-0000-0000000000a5";
const firmB = "00000000-0000-0000-0000-0000000000b5";
const point = { latitude: 51.4544, longitude: -2.6198 };
const square = (half: number) => [[[point.longitude - half, point.latitude - half], [point.longitude + half, point.latitude - half], [point.longitude + half, point.latitude + half], [point.longitude - half, point.latitude + half], [point.longitude - half, point.latitude - half]]];

// Synthetic responses shaped like the published APIs; not live records.
const planningFixture = { entities: [{ entity: 44000123, dataset: "conservation-area", name: "TEST conservation area", "entry-date": "2023-02-01" }] };
const epcFixture = { rows: [{ "lmk-key": "lmk-test", uprn: "990000000004", "current-energy-rating": "D", "property-type": "Flat", "built-form": "Mid-Terrace", "construction-age-band": "England and Wales: 1900-1929", "lodgement-date": "2023-06-12" }] };
const fetchImpl = vi.fn(async (url: URL | RequestInfo) => {
  const host = new URL(String(url)).hostname;
  const body = host === "www.planning.data.gov.uk" ? planningFixture : epcFixture;
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
});

let counter = 0;
const op = () => `op_prop_${(counter += 1).toString().padStart(6, "0")}`;

describe.skipIf(!integrationEnabled)("assistant proposals", () => {
  let database: TestDatabase;
  let surveyor: SurveyContext;
  let coordinator: SurveyContext;
  let propertyId = "";
  let surveyId = "";

  const pending = async () => (await listSurveyProposals(surveyor, surveyId)).filter((item) => item.reviewStatus === "pending");
  const proposalFor = async (fieldPath: string) => (await pending()).find((item) => item.fieldPath === fieldPath)!;

  beforeAll(async () => {
    database = await createTestDatabase();
    Object.assign(process.env, { DATABASE_APP_URL: database.appUrl, DATABASE_ADMIN_URL: database.adminUrl, PROPERTY_INTELLIGENCE_ENABLED: "true", ASSISTANT_ENABLED: "true", EPC_API_BASE_URL: "https://epc.example.test", EPC_API_TOKEN: "test-token", EPC_LICENCE_ACCEPTED: "true", EPC_DATA_PROTECTION_APPROVED: "true" });
    const admin = database.connect(database.adminUrl);
    await syncSourceRegistry(admin);
    await admin.update(referenceDataSources).set({ enabled: true, verifiedAt: new Date(), verifiedBy: "integration-test" }).where(sql`${referenceDataSources.key} in ('planning_data', 'epc_england_wales', 'historic_england_nhle')`);
    await admin.insert(organisations).values([
      { id: firmA, clerkOrganisationId: "org_a5", name: "Firm A", slug: "firm-a5", practiceType: "residential", region: "Bristol" },
      { id: firmB, clerkOrganisationId: "org_b5", name: "Firm B", slug: "firm-b5", practiceType: "residential", region: "Leeds" },
    ]);
    const [user] = await admin.insert(users).values({ clerkUserId: "user_a5", email: "surveyor@a5.test" }).returning();
    await admin.insert(organisationMemberships).values({ organisationId: firmA, userId: user.id, role: "surveyor" });
    surveyor = { organisationId: firmA, internalUserId: user.id, role: "surveyor" };
    coordinator = { organisationId: firmA, internalUserId: user.id, role: "coordinator" };
    const [client] = await admin.insert(clients).values({ organisationId: firmA, kind: "individual", displayName: "Client A" }).returning();
    const [property] = await admin.insert(properties).values({ organisationId: firmA, clientId: client.id, line1: "Flat 4, 1 Test Crescent", city: "Bristol", postcode: "BS8 4JX", country: "ENG", ...point, locationConfidence: "surveyor_confirmed", uprn: "990000000004", uprnConfirmedAt: new Date(), uprnEvidenceType: "site_inspection" }).returning();
    propertyId = property.id;
    const [job] = await admin.insert(jobs).values({ organisationId: firmA, clientId: client.id, propertyId, reference: "P-1", assignedSurveyorId: surveyor.internalUserId, serviceName: "Survey", targetDate: "2026-10-05" }).returning();
    const directory = await mkdtemp(path.join(tmpdir(), "surveynt-layer-"));
    const file = path.join(directory, "listed.geojson");
    await writeFile(file, JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { ListEntry: 9000101, Name: "TEST ONLY crescent", Grade: "II*" }, geometry: { type: "Polygon", coordinates: square(0.0003) } }] }));
    await importSpatialLayer(database.connect(database.importerUrl), { sourceKey: "historic_england_nhle", layer: "listed_building", filePath: file, datasetVersion: "synthetic-1", activate: true, importedBy: "test" });
    const run = await requestIntelligenceRefresh(surveyor, propertyId);
    if (run.kind !== "queued") throw new Error("expected a queued run");
    // Regression fixture for legacy stored snapshot shape; production uses the modern bearer adapter.
    await processIntelligenceRun(firmA, run.run.id, { fetchImpl, providers: intelligenceProviders.map(provider => provider.key === "epc_england_wales" ? legacyEpcProvider : provider) });
    const survey = await createSurvey(surveyor, job.id, { serviceLevel: "level_2" });
    if (survey.kind !== "created") throw new Error("expected a survey");
    surveyId = survey.survey.id;
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
    await stopRelay();
  });

  it("generates source-grounded suggestions with evidence and limitations, idempotently", async () => {
    const first = await refreshSurveyProposals(surveyor, surveyId);
    const second = await refreshSurveyProposals(surveyor, surveyId);
    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
    const byPath = Object.fromEntries((await pending()).map((item) => [item.fieldPath, item.proposedValue]));
    expect(byPath).toMatchObject({
      "about.property.property_type": { state: "provided", value: "flat" },
      "about.property.built_form": { state: "provided", value: "mid_terrace" },
      "about.property.construction_period": { state: "provided", value: "1900_1929" },
      "about.property.energy_rating": { state: "provided", value: "D" },
      "about.property.listed_status": { state: "provided", value: "listed" },
      "about.property.listing_grade": { state: "provided", value: "II*" },
      "about.property.conservation_area": { state: "provided", value: "in_area" },
      "inspection.visit.inspection_date": { state: "provided", value: "2026-10-05" },
    });
    const type = await proposalFor("about.property.property_type");
    expect(type).toMatchObject({ originClass: "external_record", modelVersion: "none", generator: "sourced-records-v1" });
    expect((type.evidenceRefs as { type: string }[])[0].type).toBe("intelligence_snapshot");
  });

  it("accepts and edits with provenance and evidence links, and records rejections without recreating them", async () => {
    const type = await proposalFor("about.property.property_type");
    expect(await reviewProposal(surveyor, surveyId, type.id, { decision: "accept" })).toMatchObject({ kind: "reviewed", status: "accepted" });
    expect(await reviewProposal(surveyor, surveyId, type.id, { decision: "accept" })).toMatchObject({ kind: "conflict" });
    const admin = database.connect(database.adminUrl);
    const [value] = await admin.select().from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, surveyId), eq(surveyFieldValues.fieldPath, "about.property.property_type")));
    expect(value).toMatchObject({ origin: "accepted_proposal", sourceKind: "intelligence_snapshot", sourceEventDate: "2023-06-12" });
    expect(await admin.select().from(evidenceLinks).where(eq(evidenceLinks.targetId, value.id))).toHaveLength(1);
    const built = await proposalFor("about.property.built_form");
    expect(await reviewProposal(surveyor, surveyId, built.id, { decision: "edit", value: { state: "provided", value: "end_terrace" }, note: "End of the terrace on site" })).toMatchObject({ status: "edited" });
    const rating = await proposalFor("about.property.energy_rating");
    expect(await reviewProposal(surveyor, surveyId, rating.id, { decision: "reject", note: "Certificate predates the extension" })).toMatchObject({ status: "rejected" });
    await refreshSurveyProposals(surveyor, surveyId);
    expect((await pending()).map((item) => item.fieldPath)).not.toContain("about.property.energy_rating");
  });

  it("never lets a stale suggestion overwrite a surveyor's edit, and raises a discrepancy instead", async () => {
    const period = await proposalFor("about.property.construction_period");
    const [edit] = await applySyncOperations(surveyor, surveyId, [{ type: "set_field", operationId: op(), fieldPath: "about.property.construction_period", value: { state: "provided", value: "before_1900" }, baseValueId: null }]);
    expect(edit.status).toBe("applied");
    expect(await reviewProposal(surveyor, surveyId, period.id, { decision: "accept" })).toMatchObject({ kind: "conflict" });
    const refreshed = await refreshSurveyProposals(surveyor, surveyId);
    expect(refreshed.discrepancies).toBe(1);
    expect((await pending()).map((item) => item.fieldPath)).not.toContain("about.property.construction_period");
    const admin = database.connect(database.adminUrl);
    const [task] = await admin.select().from(assistantTasks).where(and(eq(assistantTasks.surveyId, surveyId), eq(assistantTasks.kind, "discrepancy")));
    expect(task.detail).toContain("Nothing has been changed");
    const [current] = await admin.select().from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, surveyId), eq(surveyFieldValues.fieldPath, "about.property.construction_period"), sql`${surveyFieldValues.supersededAt} is null`));
    expect(current.value).toEqual({ state: "provided", value: "before_1900" });
  });

  it("requires explicit surveyor confirmation for professional assessments and keeps proposals immutable", async () => {
    const admin = database.connect(database.adminUrl);
    const [draft] = await admin.insert(fieldProposals).values({ organisationId: firmA, surveyId, fieldPath: "outside.roof_coverings.condition_rating", proposedValue: { state: "provided", value: "2" }, valueType: "condition_rating", evidenceRefs: [{ type: "media", id: "photo-x", label: "Photo" }], originClass: "model_draft", limitations: ["Draft only"], inputVersion: "test", generator: "test", dedupeKey: "test-professional" }).returning();
    expect(await reviewProposal(coordinator, surveyId, draft.id, { decision: "accept", confirmProfessional: true })).toMatchObject({ kind: "invalid" });
    expect(await reviewProposal(surveyor, surveyId, draft.id, { decision: "accept" })).toMatchObject({ kind: "invalid" });
    await expect(admin.update(fieldProposals).set({ proposedValue: { state: "provided", value: "1" } }).where(eq(fieldProposals.id, draft.id))).rejects.toThrow();
    expect(await reviewProposal(surveyor, surveyId, draft.id, { decision: "accept", confirmProfessional: true })).toMatchObject({ status: "accepted" });
    await expect(admin.update(fieldProposals).set({ reviewStatus: "rejected" }).where(eq(fieldProposals.id, draft.id))).rejects.toThrow();
  });

  it("preloads the versioned Home Survey fields, checks weather date changes and blocks demo network calls", async () => {
    const admin = database.connect(database.adminUrl);
    const [property] = await admin.select().from(properties).where(eq(properties.id, propertyId));
    const [job] = await admin.insert(jobs).values({ organisationId: firmA, clientId: property.clientId, propertyId, reference: "P-HOME", serviceName: "Level 2", assignedSurveyorId: surveyor.internalUserId }).returning();
    await admin.update(properties).set({ confirmedByUserId: surveyor.internalUserId }).where(eq(properties.id, propertyId));
    const outcome = await createSurvey(surveyor, job.id, { serviceLevel: "level_2", templateKey: "surveynt-home-survey-level-2", templateVersion: "1.1.0" });
    if (outcome.kind !== "created") throw new Error("Home Survey not created");
    const id = outcome.survey.id;
    const [saved] = await applySyncOperations(surveyor, id, [{ type: "set_field", operationId: op(), fieldPath: "a.details.inspection_date", value: { state: "provided", value: "2026-09-28" }, baseValueId: null }]);
    expect(saved.status).toBe("applied");
    const weatherFetch = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ ...point, timezone: "Europe/London", daily_units: { temperature_2m_min: "°C", temperature_2m_max: "°C", precipitation_sum: "mm", wind_speed_10m_max: "km/h" }, daily: { time: ["2026-09-28"], temperature_2m_min: [9], temperature_2m_max: [17], precipitation_sum: [2], wind_speed_10m_max: [20] } })));
    vi.stubGlobal("fetch", weatherFetch);
    vi.stubEnv("INSPECTION_WEATHER_API_URL", "https://weather.example.com/v1/archive");
    vi.stubEnv("INSPECTION_WEATHER_TERMS_APPROVED", "true");
    try {
      expect((await refreshSurveyProposals(surveyor, id, true)).weather?.status).toBe("available");
      const proposals = await listSurveyProposals(surveyor, id);
      expect(proposals.map(p => p.fieldPath)).toEqual(expect.arrayContaining(["a.details.weather", "c.details.property_type", "c.details.built_year", "c.details.local_environment"]));
      const built = proposals.find(p => p.fieldPath === "c.details.built_year")!;
      expect(await reviewProposal(surveyor, id, built.id, { decision: "accept" })).toMatchObject({ kind: "invalid" });
      expect(await reviewProposal(surveyor, id, built.id, { decision: "accept", confirmProfessional: true })).toMatchObject({ status: "accepted" });
      const weather = proposals.find(p => p.fieldPath === "a.details.weather")!;
      // A property-worker refresh must preserve independently loaded weather.
      await refreshSurveyProposals(surveyor, id);
      expect((await listSurveyProposals(surveyor, id)).find(p => p.id === weather.id)?.reviewStatus).toBe("pending");
      const [date] = await admin.select().from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, id), eq(surveyFieldValues.fieldPath, "a.details.inspection_date"), sql`${surveyFieldValues.supersededAt} is null`));
      await applySyncOperations(surveyor, id, [{ type: "set_field", operationId: op(), fieldPath: "a.details.inspection_date", value: { state: "provided", value: "2026-09-29" }, baseValueId: date.id }]);
      expect(await reviewProposal(surveyor, id, weather.id, { decision: "accept", confirmProfessional: true })).toMatchObject({ kind: "conflict" });
      const calls = weatherFetch.mock.calls.length;
      await admin.update(organisations).set({ isDemo: true }).where(eq(organisations.id, firmA));
      expect((await refreshSurveyProposals(surveyor, id, true)).weather?.status).toBe("not_checked");
      expect(weatherFetch.mock.calls).toHaveLength(calls);
    } finally {
      await admin.update(organisations).set({ isDemo: false }).where(eq(organisations.id, firmA));
      vi.unstubAllGlobals(); vi.unstubAllEnvs();
    }
  });

  it("supersedes pending suggestions when the property identity changes", async () => {
    const before = (await pending()).length;
    expect(before).toBeGreaterThan(0);
    const stale = (await pending()).find(p => p.fieldPath !== "inspection.visit.inspection_date")!;
    const admin = database.connect(database.adminUrl);
    await admin.update(properties).set({ latitude: 51.455, version: sql`${properties.version} + 1` }).where(eq(properties.id, propertyId));
    expect(await reviewProposal(surveyor, surveyId, stale.id, { decision: "accept", confirmProfessional: true })).toMatchObject({ kind: "conflict" });
    const refreshed = await refreshSurveyProposals(surveyor, surveyId);
    expect(refreshed.superseded).toBeGreaterThan(0);
    expect((await pending()).map((item) => item.fieldPath)).toEqual(["inspection.visit.inspection_date"]);
  });

  it("denies another firm's reviews", async () => {
    const remaining = await pending();
    expect(await reviewProposal({ organisationId: firmB, internalUserId: null, role: "owner" }, surveyId, remaining[0].id, { decision: "accept" })).toMatchObject({ kind: "invalid" });
    expect(await listSurveyProposals({ organisationId: firmB }, surveyId)).toHaveLength(0);
  });

  it("generates nothing when the assistant kill-switch is off", async () => {
    const admin = database.connect(database.adminUrl);
    await admin.update(properties).set({ latitude: 51.456, version: sql`${properties.version} + 1` }).where(eq(properties.id, propertyId));
    process.env.ASSISTANT_ENABLED = "false";
    try {
      expect(await refreshSurveyProposals(surveyor, surveyId)).toEqual({ created: 0, superseded: 0, discrepancies: 0 });
    } finally {
      process.env.ASSISTANT_ENABLED = "true";
    }
  });
});
