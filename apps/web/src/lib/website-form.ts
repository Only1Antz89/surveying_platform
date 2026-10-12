import {workspaceAudit} from "@/lib/workspace-audit";
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { auditEvents, createDatabase, customerQuotes, organisationOperationalSettings, organisations, serviceDefinitions, servicePricingVersions, websiteEnquiries, websiteFormDrafts, websiteFormRateWindows, websiteFormVersions, withTenant, type TenantTransaction } from "@surveynt/db";
import { defaultWebsiteForm, publicationWarnings, publicFormConfig, websiteFormSchema, type FormContext, type FormSubmission, type WebsiteFormConfig } from "./website-form-config";
import { resolvePublicOrganisation, createPublicQuote } from "./firm-operations";
import { normaliseFormAnswers } from "./website-form-config";
import { formDecision } from "./website-form-decision";

export class WebsiteFormError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export const websiteFormEditorRole = (role: string) => role === "owner" || role === "administrator";
export async function readFormStudio(organisationId: string, name: string) {
  return withTenant(createDatabase(), organisationId, async tx => {
    const [draft] = await tx.select().from(websiteFormDrafts).where(eq(websiteFormDrafts.organisationId, organisationId)).limit(1);
    const versions = await tx.select().from(websiteFormVersions).where(eq(websiteFormVersions.organisationId, organisationId)).orderBy(desc(websiteFormVersions.createdAt)).limit(20);
    return { config: draft ? websiteFormSchema.parse(draft.config) : defaultWebsiteForm(name), revision: draft?.revision ?? 0, activeVersionId: draft?.activeVersionId ?? null, versions };
  });
}
export async function changeWebsiteForm(context: { organisationId: string; internalUserId: string | null; role: string }, input: { revision: number; action: "save" | "publish" | "restore"; config?: WebsiteFormConfig; versionId?: string }) {
  if (!websiteFormEditorRole(context.role)) throw new WebsiteFormError(403, "forbidden", "Only owners and administrators can customise website forms.");
  return withTenant(createDatabase(), context.organisationId, async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`website-form:${context.organisationId}`}))`);
    const [draft] = await tx.select().from(websiteFormDrafts).where(eq(websiteFormDrafts.organisationId, context.organisationId)).limit(1);
    if ((draft?.revision ?? 0) !== input.revision) throw new WebsiteFormError(409, "draft_changed", "Another editor changed this form. Reload before saving.");
    let restoredFromId: string | null = null, config = input.config;
    if (input.action === "restore") {
      const [version] = await tx.select().from(websiteFormVersions).where(and(eq(websiteFormVersions.organisationId, context.organisationId), eq(websiteFormVersions.id, input.versionId!))).limit(1);
      if (!version) throw new WebsiteFormError(404, "version_not_found", "The published version could not be found.");
      config = websiteFormSchema.parse(version.config); restoredFromId = version.id;
    }
    config = websiteFormSchema.parse(config);
    let activeVersionId = draft?.activeVersionId ?? null;
    if (input.action !== "save") {
      const warnings = publicationWarnings(config);
      if (warnings.length) throw new WebsiteFormError(409, "publication_not_ready", warnings.join(" "));
      const [version] = await tx.insert(websiteFormVersions).values({ organisationId: context.organisationId, config, publishedByUserId: context.internalUserId, restoredFromId }).returning();
      activeVersionId = version.id;
    }
    const values = { config, revision: input.revision + 1, activeVersionId, updatedByUserId: context.internalUserId, updatedAt: new Date() };
    await tx.insert(websiteFormDrafts).values({ organisationId: context.organisationId, ...values }).onConflictDoUpdate({ target: websiteFormDrafts.organisationId, set: values });
    await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: `website_form.${input.action}`, resourceType: "website_form", resourceId: context.organisationId, metadata: { revision: values.revision, activeVersionId, restoredFromId } }));
    return values;
  });
}
export async function formCatalogue(tx: TenantTransaction, organisationId: string) {
  const rows = await tx.select({ id: serviceDefinitions.id, name: serviceDefinitions.name, pricing: servicePricingVersions }).from(serviceDefinitions).innerJoin(servicePricingVersions, and(eq(servicePricingVersions.serviceDefinitionId, serviceDefinitions.id), eq(servicePricingVersions.active, true))).where(and(eq(serviceDefinitions.organisationId, organisationId), eq(serviceDefinitions.active, true))).orderBy(desc(servicePricingVersions.version));
  const seen = new Set<string>();
  return rows.filter(row => !seen.has(row.id) && Boolean(seen.add(row.id))).map(({ id, name, pricing: p }) => ({ id, name, description: null, currency: p.currency, baseAmountMinor: p.baseAmountMinor, vatBasisPoints: p.vatBasisPoints, depositBasisPoints: p.depositBasisPoints, surcharges: p.surcharges, validityDays: p.validityDays, adviser: p.recommendationRules.source === "clifton_adviser_v1" }));
}
export async function publishedForm(organisationId: string, slug: string): Promise<FormContext | null> {
  return withTenant(createDatabase(), organisationId, async tx => {
    const [draft] = await tx.select().from(websiteFormDrafts).where(eq(websiteFormDrafts.organisationId, organisationId)).limit(1);
    if (!draft?.activeVersionId) return null;
    const [version] = await tx.select().from(websiteFormVersions).where(and(eq(websiteFormVersions.organisationId, organisationId), eq(websiteFormVersions.id, draft.activeVersionId))).limit(1);
    if (!version) return null;
    const [settings] = await tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, organisationId)).limit(1);
    const [org] = await tx.select().from(organisations).where(eq(organisations.id, organisationId)).limit(1);
    const config = websiteFormSchema.parse(version.config), catalogue = await formCatalogue(tx, organisationId);
    return { config, versionId: version.id, slug, services: catalogue.filter(s => !config.serviceIds.length || config.serviceIds.includes(s.id)), quotesReady: Boolean(settings?.publicQuotesEnabled && (org?.isDemo || process.env.QUOTE_TOKEN_SECRET)), demo: org?.isDemo ?? false };
  });
}
export async function embeddingOrigins(slug: string) {
  if (!process.env.DATABASE_APP_URL && !process.env.DATABASE_URL) return [];
  const [org] = await createDatabase().select({ id: organisations.id }).from(organisations).where(and(eq(organisations.slug, slug), eq(organisations.status, "active"))).limit(1);
  if (!org) return [];
  const form = await publishedForm(org.id, slug);
  return form?.config.enabled ? form.config.approvedOrigins : [];
}
export async function publicForm(request: Request, slug: string) {
  if (!process.env.DATABASE_APP_URL && !process.env.DATABASE_URL) return null;
  const org = await resolvePublicOrganisation(request, slug);
  if (!org) return null;
  const form = await publishedForm(org.id, slug);
    return form ? { ...form, config: publicFormConfig(form.config), services: form.config.enabled ? form.services : [], quotesReady: form.config.enabled && form.quotesReady } : null;
}
export async function requireLoadedForm(tx: TenantTransaction, organisationId: string, input: FormSubmission) {
  const [draft] = await tx.select().from(websiteFormDrafts).where(eq(websiteFormDrafts.organisationId, organisationId)).for("share").limit(1);
  const [active] = draft?.activeVersionId ? await tx.select().from(websiteFormVersions).where(and(eq(websiteFormVersions.organisationId, organisationId), eq(websiteFormVersions.id, draft.activeVersionId))).limit(1) : [];
  const [loaded] = await tx.select().from(websiteFormVersions).where(and(eq(websiteFormVersions.organisationId, organisationId), eq(websiteFormVersions.id, input.versionId))).limit(1);
  if (!active || !loaded || !websiteFormSchema.parse(active.config).enabled) throw new WebsiteFormError(409, "form_unavailable", "This form is no longer available. Please contact the practice.");
  const config = websiteFormSchema.parse(loaded.config), current = websiteFormSchema.parse(active.config);
  if (!config.enabled || !config.paths.includes(input.answers.path) || !current.paths.includes(input.answers.path)) throw new WebsiteFormError(409, "path_unavailable", "This service path is no longer available.");
  if (input.serviceId && ([config, current].some(c => c.serviceIds.length && !c.serviceIds.includes(input.serviceId!)))) throw new WebsiteFormError(409, "service_unavailable", "This service is no longer available in the website form.");
  if ((!config.questions.includes("concerns") && input.answers.concerns) || (!config.questions.includes("alterations") && input.answers.alterationTypes.length) || (!config.questions.includes("phone") && input.phone)) throw new WebsiteFormError(400, "unexpected_answer", "An answer is not enabled for this form.");
  return { config, current };
}
export async function submitWebsiteForm(request: Request, input: FormSubmission) {
  if (input.website) throw new WebsiteFormError(400, "invalid_submission", "The enquiry could not be submitted.");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new WebsiteFormError(403, "invalid_origin", "Submit using the Surveynt form.");
  const org = await resolvePublicOrganisation(request, input.organisationSlug);
  if (!org) throw new WebsiteFormError(404, "practice_not_found", "This practice could not be found.");
  // Proxy-controlled IP is used only when explicitly trusted; otherwise the per-firm limit applies.
  const ip = process.env.TRUST_PROXY_IP === "true" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown" : "firm";
  const key = createHash("sha256").update(ip).digest("hex"), requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const form = await publishedForm(org.id, org.slug);
  if (!form) throw new WebsiteFormError(409, "form_unavailable", "Online enquiries are unavailable.");
  const answers = normaliseFormAnswers(input.answers);
  const { service } = formDecision(form, input.answers, input.serviceId);
  await withTenant(createDatabase(), org.id, async tx => {
    await requireLoadedForm(tx, org.id, input);
    const limit = ip === "firm" ? 100 : 10;
    const rows = await tx.insert(websiteFormRateWindows).values({ organisationId: org.id, key, windowStart: new Date(), count: 1 }).onConflictDoUpdate({ target: [websiteFormRateWindows.organisationId, websiteFormRateWindows.key], set: { windowStart: sql`case when ${websiteFormRateWindows.windowStart} < now() - interval '10 minutes' then now() else ${websiteFormRateWindows.windowStart} end`, count: sql`case when ${websiteFormRateWindows.windowStart} < now() - interval '10 minutes' then 1 else ${websiteFormRateWindows.count} + 1 end` }, setWhere: sql`${websiteFormRateWindows.windowStart} < now() - interval '10 minutes' or ${websiteFormRateWindows.count} < ${limit}` }).returning();
    if (!rows.length) throw new WebsiteFormError(429, "rate_limited", "Too many requests. Please wait before trying again.");
  });
  if (service && form.quotesReady) {
    const result = await createPublicQuote({ organisationId: org.id, requestId: input.requestId, firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone, serviceId: service.id, answers: { ...answers, address: input.address, websiteFormVersionId: input.versionId, customerStatement: true }, surchargeKeys: input.answers.alterationTypes, websiteSubmission: input });
    return { kind: "quote" as const, ...result };
  }
  return withTenant(createDatabase(), org.id, async tx => {
    const { config, current } = await requireLoadedForm(tx, org.id, input);
    if (!config.enquiriesEnabled || !current.enquiriesEnabled) throw new WebsiteFormError(409, "enquiries_disabled", "Please contact the practice directly to discuss this enquiry.");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`website-submission:${org.id}:${input.requestId}`}))`);
    const [quote] = await tx.select({ id: customerQuotes.id }).from(customerQuotes).where(and(eq(customerQuotes.organisationId, org.id), eq(customerQuotes.publicRequestId, input.requestId))).limit(1);
    if (quote) throw new WebsiteFormError(409, "request_already_submitted", "This request already created a quote. Use its secure customer link rather than submitting another enquiry.");
    const [duplicate] = await tx.select().from(websiteEnquiries).where(and(eq(websiteEnquiries.organisationId, org.id), eq(websiteEnquiries.requestId, input.requestId))).limit(1);
    if (duplicate && duplicate.requestHash !== requestHash) throw new WebsiteFormError(409, "request_changed", "Use a new submission after changing your answers.");
    const reason = input.answers.path !== "residential" ? "Bespoke commercial / land enquiry" : !form.quotesReady ? "Online quoting unavailable; staff review required" : "No supported instant-quote match; staff review required";
    const enquiry = duplicate ?? (await tx.insert(websiteEnquiries).values({ organisationId: org.id, formVersionId: input.versionId, requestId: input.requestId, requestHash, reference: `ENQ-${randomBytes(5).toString("hex").toUpperCase()}`, firstName: input.firstName, lastName: input.lastName, email: input.email.toLowerCase(), phone: input.phone, address: input.address, answers: { ...answers, customerStatement: true }, reason, isDemo: form.demo }).returning())[0];
    if (!duplicate) await tx.insert(auditEvents).values({ organisationId: org.id, action: "website_enquiry.created", resourceType: "website_enquiry", resourceId: enquiry.id, metadata: { formVersionId: input.versionId, demo: form.demo } });
    return { kind: "enquiry" as const, reference: enquiry.reference, demo: enquiry.isDemo };
  });
}
