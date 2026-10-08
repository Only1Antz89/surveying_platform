import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { customerQuotes, organisations, organisationOperationalSettings, serviceDefinitions, servicePricingVersions, websiteEnquiries, websiteFormVersions, withTenant } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only", () => ({}));
const apiState = vi.hoisted(() => ({ context: null as null | { organisationId: string; internalUserId: null; role: string; accessLevel: string; demo: boolean } }));
vi.mock("@/lib/access", () => ({ apiContext: vi.fn(async () => apiState.context), canWriteWorkspace: (c: { accessLevel: string }) => c.accessLevel === "full" }));
import { GET as getStudio, PATCH as patchStudio } from "@/app/api/v1/operations/website-form/route";
import { NextRequest } from "next/server";
import proxy from "@/proxy";
import { changeWebsiteForm, readFormStudio, publishedForm, submitWebsiteForm, embeddingOrigins } from "@/lib/website-form";
import { defaultWebsiteForm, type FormSubmission } from "@/lib/website-form-config";
describe.skipIf(!integrationEnabled)("website form publication, enquiry and quote isolation", () => {
  let database: TestDatabase; const org = crypto.randomUUID(), other = crypto.randomUUID(), service = crypto.randomUUID();
  const owner = { organisationId: org, internalUserId: null, role: "owner" };
  const config = { ...defaultWebsiteForm("Example practice"), enabled: true, enquiriesEnabled: true, contactEmail: "practice@example.test", privacyUrl: "https://example.test/privacy", approvedOrigins: ["https://example.test"] };
  const request = new Request("https://surveynt.example/api/v1/public/website-form/submissions", { method: "POST", headers: { origin: "https://surveynt.example" } });
  let input: FormSubmission;
  beforeAll(async () => {
    database = await createTestDatabase(); process.env.DATABASE_ADMIN_URL = database.adminUrl; process.env.DATABASE_APP_URL = database.appUrl; process.env.QUOTE_TOKEN_SECRET = "integration-only-example-secret";
    const db = database.connect(database.adminUrl);
    await db.insert(organisations).values([{ id: org, clerkOrganisationId: `embed-${org}`, slug: "embed-example", name: "Example", practiceType: "residential", region: "England", status: "active" }, { id: other, clerkOrganisationId: `embed-${other}`, slug: "embed-other", name: "Other", practiceType: "residential", region: "England", status: "active" }]);
    await db.insert(organisationOperationalSettings).values({ organisationId: org, publicQuotesEnabled: true });
    await db.insert(serviceDefinitions).values({ id: service, organisationId: org, name: "RICS Level 2 Survey Only" });
    await db.insert(servicePricingVersions).values({ organisationId: org, serviceDefinitionId: service, version: 1, baseAmountMinor: 45000, recommendationRules: { source: "clifton_adviser_v1" } });
    const saved = await changeWebsiteForm(owner, { action: "publish", revision: 0, config });
    input = { organisationSlug: "embed-example", versionId: saved.activeVersionId!, requestId: crypto.randomUUID(), firstName: "Fictional", lastName: "Customer", email: "customer@example.test", phone: "", address: { line1: "1 Example Road", line2: "", city: "Bristol", postcode: "BS1 1AA", country: "ENG" }, answers: { path: "land", purpose: "bespoke", propertyType: "Woodland", propertyAge: "unknown", alterationTypes: [], concerns: "Access enquiry" }, privacyAcknowledged: true, website: "" };
  }, 120_000);
  afterAll(async () => { await database?.drop(); await stopRelay(); });
  it("keeps drafts separate, checks revision, denies managers and republishes rollback immutably", async () => {
    expect((await publishedForm(org, "embed-example"))!.config.heading).toBe(config.heading);
    await expect(changeWebsiteForm({ ...owner, role: "manager" }, { action: "save", revision: 1, config })).rejects.toMatchObject({ status: 403 });
    await changeWebsiteForm(owner, { action: "save", revision: 1, config: { ...config, heading: "Draft heading" } });
    expect((await publishedForm(org, "embed-example"))!.config.heading).toBe(config.heading);
    await expect(changeWebsiteForm(owner, { action: "publish", revision: 1, config })).rejects.toMatchObject({ status: 409 });
    const newVersion = await changeWebsiteForm(owner, { action: "publish", revision: 2, config: { ...config, heading: "Published heading" } });
    expect((await publishedForm(org, "embed-example"))!.config.heading).toBe("Published heading");
    const restored = await changeWebsiteForm(owner, { action: "restore", revision: 3, versionId: input.versionId });
    expect(restored.activeVersionId).not.toBe(input.versionId); expect(restored.activeVersionId).not.toBe(newVersion.activeVersionId);
    expect(await embeddingOrigins("embed-example")).toEqual(["https://example.test"]);
    const app = database.connect(database.appUrl);
    await expect(withTenant(app, org, tx => tx.update(websiteFormVersions).set({ config: {} }).where(eq(websiteFormVersions.id, input.versionId)))).rejects.toMatchObject({ cause: { message: expect.stringMatching(/immutable/) } });
    expect((await readFormStudio(org, "Example")).versions).toHaveLength(3);
  });
  it("stores bespoke enquiries once, keeps customer statements and rejects changed retries", async () => {
    const result = await submitWebsiteForm(request, input); expect(result.kind).toBe("enquiry");
    expect(await submitWebsiteForm(request, input)).toEqual(result);
    await expect(submitWebsiteForm(request, { ...input, firstName: "Changed" })).rejects.toMatchObject({ status: 409 });
    const rows = await withTenant(database.connect(database.appUrl), org, tx => tx.select().from(websiteEnquiries)); expect(rows).toHaveLength(1); expect(rows[0].answers.customerStatement).toBe(true);
  });
  it("sets exact-domain framing policy and protects staff and customer portal pages", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", ""); vi.stubEnv("CLERK_SECRET_KEY", "");
    const event = {} as Parameters<typeof proxy>[1];
    expect((await proxy(new NextRequest("https://surveynt.example/embed/embed-example"), event)).headers.get("content-security-policy")).toBe("frame-ancestors https://example.test");
    expect((await proxy(new NextRequest("https://surveynt.example/embed/unknown-example"), event)).headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    for (const path of ["/app/embed-example/settings/website-form", "/quote/example"]) expect((await proxy(new NextRequest(`https://surveynt.example${path}`), event)).headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect((await proxy(new NextRequest("https://surveynt.example/website-form-preview/embed-example"), event)).headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    vi.unstubAllEnvs();
  });
  it("creates canonical quotes with address evidence and idempotent secure portal tokens", async () => {
    const data = { ...input, requestId: crypto.randomUUID(), answers: { ...input.answers, path: "residential" as const, purpose: "condition-survey" as const, propertyType: "Detached house", propertyAge: "1950-1989" as const } };
    const first = await submitWebsiteForm(request, data), retry = await submitWebsiteForm(request, data);
    expect(first.kind).toBe("quote"); if (first.kind !== "quote" || retry.kind !== "quote") throw new Error("quote expected");
    expect(retry.token).toBe(first.token); expect(retry.quote.id).toBe(first.quote.id); expect(first.quote.totalMinor).toBe(54000);
    const [quote] = await withTenant(database.connect(database.appUrl), org, tx => tx.select().from(customerQuotes).where(eq(customerQuotes.id, first.quote.id)));
    expect(quote.propertyAddress).toContain("BS1 1AA"); expect(quote.answers.address).toEqual(input.address);
    await expect(submitWebsiteForm(request, { ...data, answers: { ...data.answers, concerns: "Changed" } })).rejects.toThrow("QUOTE_REQUEST_CHANGED");
  });
  it("rejects foreign versions, cross-origin requests, honeypots and cross-tenant RLS reads/writes", async () => {
    await expect(submitWebsiteForm(request, { ...input, versionId: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
    await expect(submitWebsiteForm(new Request(request.url, { headers: { origin: "https://attacker.example" } }), input)).rejects.toMatchObject({ status: 403 });
    await expect(submitWebsiteForm(request, { ...input, website: "bot" })).rejects.toMatchObject({ status: 400 });
    const app = database.connect(database.appUrl);
    expect(await withTenant(app, other, tx => tx.select().from(websiteFormVersions))).toHaveLength(0);
    expect(await withTenant(app, other, tx => tx.select().from(websiteEnquiries))).toHaveLength(0);
    await expect(withTenant(app, other, tx => tx.insert(websiteFormVersions).values({ organisationId: org, config }))).rejects.toThrow();
  });
  it("rejects old in-flight submissions after form disablement", async () => {
    await changeWebsiteForm(owner, { action: "publish", revision: 4, config: { ...config, enabled: false } });
    expect(await embeddingOrigins("embed-example")).toEqual([]);
    await expect(submitWebsiteForm(request, { ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
  });
  it("enforces authenticated owner/admin API access, read-only access and bounded bodies", async () => {
    const read = new Request("https://surveynt.example/api/v1/operations/website-form");
    expect((await getStudio(read)).status).toBe(401);
    for (const role of ["manager", "surveyor", "finance", "coordinator", "read_only"]) { apiState.context = { ...owner, role, accessLevel: "full", demo: false }; expect((await getStudio(read)).status).toBe(403); }
    for (const role of ["owner", "administrator"]) { apiState.context = { ...owner, role, accessLevel: "full", demo: false }; expect((await getStudio(read)).status).toBe(200); }
    apiState.context = { ...owner, accessLevel: "read_only", demo: false };
    expect((await patchStudio(new Request(read, { method: "PATCH", body: "{}" }))).status).toBe(403);
    apiState.context = { ...owner, accessLevel: "full", demo: false };
    expect((await patchStudio(new Request(read, { method: "PATCH", body: "x".repeat(33000) }))).status).toBe(413);
    expect((await patchStudio(new Request(read, { method: "PATCH", body: "not-json" }))).status).toBe(400);
    apiState.context = null;
  });
});
