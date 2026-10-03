import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  appointments, auditEvents, clientPayments, clients, createDatabase, customerQuotes,
  invoices, invoiceLineItems, jobs, organisationDomains, organisationOperationalSettings, organisations, properties,
  quoteSnapshots, serviceDefinitions, servicePricingVersions, settlementLedger, organisationDocuments, withTenant,
} from "@surveynt/db";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const tokenForRequest = (organisationId: string, requestId: string) => {
  if (!process.env.QUOTE_TOKEN_SECRET) throw new Error("QUOTE_TOKEN_SECRET_REQUIRED");
  return createHmac("sha256", process.env.QUOTE_TOKEN_SECRET).update(`${organisationId}:${requestId}`).digest("base64url");
};
const publicQuote = (quote: typeof customerQuotes.$inferSelect) => ({
  id: quote.id, reference: quote.reference, status: quote.status, firstName: quote.firstName, propertyAddress: quote.propertyAddress,
  currency: quote.currency, subtotalMinor: quote.subtotalMinor, vatMinor: quote.vatMinor, totalMinor: quote.totalMinor,
  depositMinor: quote.depositMinor, expiresAt: quote.expiresAt.toISOString(), acceptedAt: quote.acceptedAt?.toISOString() ?? null,
  converted: Boolean(quote.jobId), balanceMinor: Math.max(0, quote.totalMinor - quote.depositMinor), pricing: quote.pricingSnapshot, recommendation: quote.recommendation,
});
export function calculateQuoteMoney(baseAmountMinor: number, vatBasisPoints: number, depositBasisPoints: number, surcharges: Array<{ amountMinor: number }>) {
  const surchargeMinor = surcharges.reduce((sum, value) => sum + value.amountMinor, 0);
  const subtotalMinor = baseAmountMinor + surchargeMinor;
  const vatMinor = Math.round(subtotalMinor * vatBasisPoints / 10_000);
  const totalMinor = subtotalMinor + vatMinor;
  return { surchargeMinor, subtotalMinor, vatMinor, totalMinor, depositMinor: Math.round(totalMinor * depositBasisPoints / 10_000) };
}

export async function resolvePublicOrganisation(request: Request, requestedSlug?: string) {
  const db = createDatabase();
  const hostname = new URL(request.url).hostname.toLowerCase();
  const [record] = requestedSlug
    ? await db.select({ id: organisations.id, slug: organisations.slug, name: organisations.name }).from(organisations).where(and(eq(organisations.slug, requestedSlug), eq(organisations.status, "active"))).limit(1)
    : await db.select({ id: organisations.id, slug: organisations.slug, name: organisations.name }).from(organisationDomains).innerJoin(organisations, eq(organisationDomains.organisationId, organisations.id)).where(and(eq(organisationDomains.hostname, hostname), eq(organisations.status, "active"), sql`${organisationDomains.verifiedAt} is not null`)).limit(1);
  return record ?? null;
}

export function recommendCliftonService(answers: Record<string, unknown>) {
  const purpose = String(answers.purpose ?? ""); const age = String(answers.propertyAge ?? ""); const type = String(answers.propertyType ?? ""); const concerns = String(answers.concerns ?? "").toLowerCase(); const altered = answers.extensions === true;
  if (purpose === "formal-valuation") return { match: "Valuation Report", reason: "A formal independent valuation was requested rather than a building-condition survey." };
  if (purpose === "roof-only") return { match: "Drone Survey", reason: "A targeted inspection of inaccessible roof or high-level elements was requested." };
  if (age === "pre-1950" || age === "listed-historic" || altered || /damp|crack|structure/.test(concerns)) return { match: "RICS Level 3 Survey", reason: "The age, alterations or stated defect concerns indicate that a more detailed Level 3 inspection is proportionate." };
  if (purpose === "survey-and-valuation") return { match: "RICS Level 2 Survey", reason: "A combined condition survey and market valuation was requested for a conventional property." };
  if (type === "flat" && age === "post-1990" || age === "post-1990") return { match: "RICS Level 1 Survey", reason: "A concise condition report is proportionate for the stated modern, conventional property." };
  return { match: "RICS Level 2 Survey Only", reason: "A Level 2 survey provides balanced condition advice for the stated conventional property." };
}

export async function createPublicQuote(input: { organisationId: string; requestId: string; serviceId?: string; firstName?: string; lastName?: string; email?: string; phone?: string; answers?: Record<string, unknown>; surchargeKeys?: string[] }) {
  const db = createDatabase();
  const rawToken = tokenForRequest(input.organisationId, input.requestId);
  return withTenant(db, input.organisationId, async (tx) => {
    const [duplicate] = await tx.select().from(customerQuotes).where(and(eq(customerQuotes.organisationId, input.organisationId), eq(customerQuotes.publicRequestId, input.requestId))).limit(1);
    if (duplicate) return { quote: publicQuote(duplicate), token: rawToken, duplicate: true };
    const [settings, selected, catalogue] = await Promise.all([
      tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, input.organisationId)).limit(1).then((rows) => rows[0]),
      input.serviceId ? tx.select({ service: serviceDefinitions, pricing: servicePricingVersions }).from(serviceDefinitions).innerJoin(servicePricingVersions, and(eq(servicePricingVersions.serviceDefinitionId, serviceDefinitions.id), eq(servicePricingVersions.active, true))).where(and(eq(serviceDefinitions.id, input.serviceId), eq(serviceDefinitions.organisationId, input.organisationId), eq(serviceDefinitions.active, true))).orderBy(desc(servicePricingVersions.version)).limit(1).then((rows) => rows[0]) : Promise.resolve(undefined),
      tx.select({ service: serviceDefinitions, pricing: servicePricingVersions }).from(serviceDefinitions).innerJoin(servicePricingVersions, and(eq(servicePricingVersions.serviceDefinitionId, serviceDefinitions.id), eq(servicePricingVersions.active, true))).where(and(eq(serviceDefinitions.organisationId, input.organisationId), eq(serviceDefinitions.active, true))).orderBy(desc(servicePricingVersions.version)),
    ]);
    if (!settings?.publicQuotesEnabled) throw new Error("PUBLIC_QUOTES_DISABLED");
    const recommendation = recommendCliftonService(input.answers ?? {});
    const recommended = !input.serviceId && catalogue.some((item) => item.pricing.recommendationRules.source === "clifton_adviser_v1") ? catalogue.find((item) => item.service.name === recommendation.match) ?? catalogue.find((item) => item.service.name.includes(recommendation.match)) : undefined;
    const service = selected?.service ?? recommended?.service; const pricing = selected?.pricing ?? recommended?.pricing;
    if (!service || !pricing) throw new Error("SERVICE_UNAVAILABLE");
    const surchargeEntries = Object.entries(pricing.surcharges).filter(([key]) => input.surchargeKeys?.includes(key));
    const { subtotalMinor, vatMinor, totalMinor, depositMinor } = calculateQuoteMoney(pricing.baseAmountMinor, pricing.vatBasisPoints, pricing.depositBasisPoints, surchargeEntries.map(([, value]) => value));
    const expiresAt = new Date(Date.now() + pricing.validityDays * 86_400_000);
    const reference = `SVQ-${new Date().getUTCFullYear()}-${randomBytes(5).toString("hex").toUpperCase()}`;
    const snapshot = { service: service.name, pricingVersion: pricing.version, baseAmountMinor: pricing.baseAmountMinor, surcharges: Object.fromEntries(surchargeEntries), vatBasisPoints: pricing.vatBasisPoints, depositBasisPoints: pricing.depositBasisPoints, durationMinutes: pricing.durationMinutes };
    const [quote] = await tx.insert(customerQuotes).values({ organisationId: input.organisationId, publicRequestId: input.requestId, serviceDefinitionId: service.id, pricingVersionId: pricing.id, reference, status: input.email ? "issued" : "draft", firstName: input.firstName, lastName: input.lastName, email: input.email?.toLowerCase(), phone: input.phone, answers: input.answers ?? {}, recommendation: { serviceId: service.id, serviceName: service.name, basis: input.serviceId ? "customer_selected" : "clifton_adviser_v1", reason: recommendation.reason }, pricingSnapshot: snapshot, currency: pricing.currency, subtotalMinor, vatMinor, totalMinor, depositMinor, accessTokenHash: tokenHash(rawToken), expiresAt, issuedAt: input.email ? new Date() : null }).returning();
    await tx.insert(quoteSnapshots).values({ organisationId: input.organisationId, quoteId: quote.id, event: "created", snapshot: publicQuote(quote) });
    await tx.insert(auditEvents).values({ organisationId: input.organisationId, action: "quote.created", resourceType: "quote", resourceId: quote.id, metadata: { reference, serviceId: service.id } });
    return { quote: publicQuote(quote), token: rawToken };
  });
}

export async function readPublicQuote(id: string, token: string) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("PUBLIC_QUOTE_STORAGE_UNAVAILABLE");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [quote] = await db.select().from(customerQuotes).where(and(eq(customerQuotes.id, id), eq(customerQuotes.accessTokenHash, tokenHash(token)), isNull(customerQuotes.tokenRevokedAt))).limit(1);
  if (!quote) return null;
  if (quote.status !== "converted" && quote.status !== "cancelled" && quote.expiresAt < new Date()) {
    await db.update(customerQuotes).set({ status: "expired", updatedAt: new Date(), version: quote.version + 1 }).where(and(eq(customerQuotes.id, quote.id), eq(customerQuotes.version, quote.version)));
    quote.status = "expired";
  }
  const [balance] = quote.jobId ? await db.select({ status: clientPayments.status }).from(clientPayments).where(and(eq(clientPayments.quoteId, quote.id), eq(clientPayments.purpose, "balance"), eq(clientPayments.status, "succeeded"))).limit(1) : [];
  return { row: quote, view: { ...publicQuote(quote), balancePaid: Boolean(balance) } };
}

export async function acceptQuoteAddress(id: string, token: string, address: { line1: string; city: string; postcode: string }) {
  const found = await readPublicQuote(id, token);
  if (!found || found.row.status === "expired" || found.row.status === "cancelled") return null;
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const propertyAddress = `${address.line1}, ${address.city}, ${address.postcode.toUpperCase()}`;
  const [updated] = await db.update(customerQuotes).set({ propertyAddress, city: address.city, postcode: address.postcode.toUpperCase(), status: "accepted", acceptedAt: found.row.acceptedAt ?? new Date(), updatedAt: new Date(), version: found.row.version + 1 }).where(and(eq(customerQuotes.id, id), eq(customerQuotes.version, found.row.version))).returning();
  if (!updated) throw new Error("QUOTE_CHANGED");
  await db.insert(quoteSnapshots).values({ organisationId: updated.organisationId, quoteId: updated.id, event: "accepted", snapshot: publicQuote(updated) });
  await db.insert(auditEvents).values({ organisationId: updated.organisationId, action: "quote.accepted", resourceType: "quote", resourceId: updated.id, metadata: { reference: updated.reference } });
  return { row: updated, view: publicQuote(updated) };
}

export async function createPendingDeposit(quote: typeof customerQuotes.$inferSelect) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("PAYMENTS_UNAVAILABLE");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const existing = await db.select({ payment: clientPayments, invoice: invoices }).from(clientPayments).innerJoin(invoices, eq(clientPayments.invoiceId, invoices.id)).where(and(eq(clientPayments.quoteId, quote.id), eq(clientPayments.purpose, "deposit"), or(eq(clientPayments.status, "pending"), eq(clientPayments.status, "succeeded")))).limit(1);
  if (existing[0]) return existing[0];
  return db.transaction(async (tx) => {
    const [invoice] = await tx.insert(invoices).values({ organisationId: quote.organisationId, quoteId: quote.id, number: `${quote.reference}-D`, status: "open", currency: quote.currency, subtotalMinor: quote.depositMinor, vatMinor: 0, totalMinor: quote.depositMinor, dueAt: quote.expiresAt, issuedAt: new Date() }).returning();
    await tx.insert(invoiceLineItems).values({ organisationId: quote.organisationId, invoiceId: invoice.id, description: `Deposit for ${String((quote.pricingSnapshot as Record<string, unknown>).service ?? "survey")}`, unitAmountMinor: quote.depositMinor, vatBasisPoints: 0 });
    const [payment] = await tx.insert(clientPayments).values({ organisationId: quote.organisationId, invoiceId: invoice.id, quoteId: quote.id, purpose: "deposit", currency: quote.currency, amountMinor: quote.depositMinor }).returning();
    return { invoice, payment };
  });
}

export async function createPendingBalance(quote: typeof customerQuotes.$inferSelect) {
  if (!process.env.DATABASE_ADMIN_URL || !quote.jobId) throw new Error("PAYMENTS_UNAVAILABLE"); const amountMinor = Math.max(0, quote.totalMinor - quote.depositMinor); if (!amountMinor) throw new Error("NO_BALANCE_DUE"); const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const existing = await db.select({ payment: clientPayments, invoice: invoices }).from(clientPayments).innerJoin(invoices, eq(clientPayments.invoiceId, invoices.id)).where(and(eq(clientPayments.quoteId, quote.id), eq(clientPayments.purpose, "balance"), or(eq(clientPayments.status, "pending"), eq(clientPayments.status, "succeeded")))).limit(1); if (existing[0]) return existing[0];
  return db.transaction(async (tx) => { const [invoice] = await tx.insert(invoices).values({ organisationId: quote.organisationId, jobId: quote.jobId, quoteId: quote.id, number: `${quote.reference}-B`, status: "open", currency: quote.currency, subtotalMinor: amountMinor, vatMinor: 0, totalMinor: amountMinor, dueAt: new Date(Date.now() + 14 * 86_400_000), issuedAt: new Date() }).returning(); await tx.insert(invoiceLineItems).values({ organisationId: quote.organisationId, invoiceId: invoice.id, description: `Balance for ${String((quote.pricingSnapshot as Record<string, unknown>).service ?? "survey")}`, unitAmountMinor: amountMinor, vatBasisPoints: 0 }); const [payment] = await tx.insert(clientPayments).values({ organisationId: quote.organisationId, invoiceId: invoice.id, quoteId: quote.id, purpose: "balance", currency: quote.currency, amountMinor }).returning(); await tx.insert(auditEvents).values({ organisationId: quote.organisationId, action: "invoice.balance_issued", resourceType: "invoice", resourceId: invoice.id, metadata: { quoteId: quote.id, amountMinor } }); return { invoice, payment }; });
}

export async function settleBalancePayment(input: { paymentId: string; checkoutSessionId: string; paymentIntentId: string | null }) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required."); const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  return db.transaction(async (tx) => { const [record] = await tx.select({ payment: clientPayments, invoice: invoices }).from(clientPayments).innerJoin(invoices, eq(clientPayments.invoiceId, invoices.id)).where(eq(clientPayments.id, input.paymentId)).for("update").limit(1); if (!record || record.payment.purpose !== "balance") throw new Error("Balance payment was not found."); if (record.payment.status === "succeeded") return record.invoice.jobId; await tx.update(clientPayments).set({ status: "succeeded", stripeCheckoutSessionId: input.checkoutSessionId, stripePaymentIntentId: input.paymentIntentId, succeededAt: new Date(), updatedAt: new Date() }).where(eq(clientPayments.id, record.payment.id)); await tx.update(invoices).set({ status: "paid", paidAt: new Date(), updatedAt: new Date() }).where(eq(invoices.id, record.invoice.id)); await tx.insert(settlementLedger).values({ organisationId: record.payment.organisationId, paymentId: record.payment.id, entryType: "firm_liability", currency: record.payment.currency, amountMinor: record.payment.amountMinor, metadata: { jobId: record.invoice.jobId, purpose: "balance" } }); await tx.insert(auditEvents).values({ organisationId: record.payment.organisationId, action: "client_payment.balance_succeeded", resourceType: "client_payment", resourceId: record.payment.id, metadata: { invoiceId: record.invoice.id } }); return record.invoice.jobId; });
}

export async function convertPaidQuote(input: { paymentId: string; checkoutSessionId: string; paymentIntentId: string | null }) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  return db.transaction(async (tx) => {
    const [record] = await tx.select({ payment: clientPayments, invoice: invoices, quote: customerQuotes }).from(clientPayments).innerJoin(invoices, eq(clientPayments.invoiceId, invoices.id)).innerJoin(customerQuotes, eq(clientPayments.quoteId, customerQuotes.id)).where(eq(clientPayments.id, input.paymentId)).for("update").limit(1);
    if (!record) throw new Error("Client payment was not found.");
    if (record.payment.status === "succeeded" && record.quote.jobId) return record.quote.jobId;
    const quote = record.quote;
    const [client] = await tx.insert(clients).values({ organisationId: quote.organisationId, kind: "individual", displayName: [quote.firstName, quote.lastName].filter(Boolean).join(" ") || quote.email || quote.reference, email: quote.email, phone: quote.phone }).returning();
    const addressParts = (quote.propertyAddress ?? "Address pending").split(",").map((part) => part.trim());
    const [property] = await tx.insert(properties).values({ organisationId: quote.organisationId, clientId: client.id, line1: addressParts[0] || "Address pending", city: quote.city || addressParts.at(-2) || "Unknown", postcode: quote.postcode || "UNKNOWN", country: "ENG", addressSource: "customer_quote" }).returning();
    const [job] = await tx.insert(jobs).values({ organisationId: quote.organisationId, clientId: client.id, propertyId: property.id, reference: quote.reference.replace("SVQ", "SVJ"), serviceName: String((quote.pricingSnapshot as Record<string, unknown>).service ?? "Survey"), stage: "instructed", fee: (quote.totalMinor / 100).toFixed(2), notes: `Customer quote ${quote.reference}; customer statements remain unverified.` }).returning();
    await tx.update(customerQuotes).set({ status: "converted", clientId: client.id, propertyId: property.id, jobId: job.id, updatedAt: new Date(), version: quote.version + 1 }).where(eq(customerQuotes.id, quote.id));
    await tx.update(invoices).set({ jobId: job.id, status: "paid", paidAt: new Date(), updatedAt: new Date() }).where(eq(invoices.id, record.invoice.id));
    await tx.update(clientPayments).set({ status: "succeeded", stripeCheckoutSessionId: input.checkoutSessionId, stripePaymentIntentId: input.paymentIntentId, succeededAt: new Date(), updatedAt: new Date() }).where(eq(clientPayments.id, record.payment.id));
    await tx.insert(settlementLedger).values({ organisationId: quote.organisationId, paymentId: record.payment.id, entryType: "firm_liability", currency: quote.currency, amountMinor: record.payment.amountMinor, metadata: { quoteId: quote.id, jobId: job.id } });
    await tx.insert(quoteSnapshots).values({ organisationId: quote.organisationId, quoteId: quote.id, event: "converted", snapshot: { ...publicQuote({ ...quote, status: "converted", clientId: client.id, propertyId: property.id, jobId: job.id }), clientId: client.id, propertyId: property.id, jobId: job.id } });
    await tx.insert(auditEvents).values({ organisationId: quote.organisationId, action: "quote.converted", resourceType: "job", resourceId: job.id, metadata: { quoteId: quote.id, paymentId: record.payment.id } });
    return job.id;
  });
}

export async function listFirmOperations(organisationId: string) {
  const db = createDatabase();
  return withTenant(db, organisationId, async (tx) => {
    const [quotes, scheduled, finance, documents] = await Promise.all([
      tx.select().from(customerQuotes).where(eq(customerQuotes.organisationId, organisationId)).orderBy(desc(customerQuotes.updatedAt)).limit(100),
      tx.select().from(appointments).where(and(eq(appointments.organisationId, organisationId), gt(appointments.endsAt, new Date(Date.now() - 31 * 86_400_000)))).orderBy(asc(appointments.startsAt)).limit(200),
      tx.select({ invoice: invoices, payment: clientPayments }).from(invoices).leftJoin(clientPayments, eq(clientPayments.invoiceId, invoices.id)).where(eq(invoices.organisationId, organisationId)).orderBy(desc(invoices.createdAt)).limit(100),
      tx.select({ id: organisationDocuments.id, name: organisationDocuments.name, category: organisationDocuments.category, checksum: organisationDocuments.checksum, sizeBytes: organisationDocuments.sizeBytes, legalHold: organisationDocuments.legalHold, retentionUntil: organisationDocuments.retentionUntil, createdAt: organisationDocuments.createdAt }).from(organisationDocuments).where(and(eq(organisationDocuments.organisationId, organisationId), isNull(organisationDocuments.deletedAt))).orderBy(desc(organisationDocuments.createdAt)).limit(200),
    ]);
    return { quotes, appointments: scheduled, finance, documents };
  });
}
export type FirmOperationsData = Awaited<ReturnType<typeof listFirmOperations>>;
