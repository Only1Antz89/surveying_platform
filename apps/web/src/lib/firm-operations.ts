import {workspaceAudit} from "./workspace-audit";
import type {WorkspaceMode} from "./workspace-mode";
import { invoiceBalance, refreshInvoiceBalance } from "./invoice-balance";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, getTableColumns, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { isDemoOrganisation } from "./stakeholder-demo";
import { documentAccess } from "./document-access";
import type { OrganisationRole } from "@surveynt/domain";
import { apiContext } from "./access";
import { quoteMoney, recommendCliftonService, selectRecommendedService } from "./survey-adviser";
import type { FormSubmission } from "./website-form-config";
import { propertyAddressSchema } from "./website-form-config";
export { recommendCliftonService } from "./survey-adviser";
import {
  type TenantTransaction, appointments, auditEvents, clientPayments, clients, createDatabase, customerQuotes,
  invoiceCredits, invoices, invoiceLineItems, jobs, organisationDomains, organisationOperationalSettings, organisations, properties,
  quoteSnapshots, serviceDefinitions, servicePricingVersions, settlementLedger, organisationDocuments, websiteEnquiries, withTenant,
} from "@surveynt/db";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const tokenForRequest = (organisationId: string, requestId: string) => {
  if (!process.env.QUOTE_TOKEN_SECRET) throw new Error("QUOTE_TOKEN_SECRET_REQUIRED");
  return createHmac("sha256", process.env.QUOTE_TOKEN_SECRET).update(`${organisationId}:${requestId}`).digest("base64url");
};
const publicQuote = (quote: typeof customerQuotes.$inferSelect) => ({
  id: quote.id, reference: quote.reference, status: quote.status, firstName: quote.firstName, propertyAddress: quote.propertyAddress,
  city: quote.city, postcode: quote.postcode, address: propertyAddressSchema.safeParse(quote.answers.address).data ?? null,
  currency: quote.currency, subtotalMinor: quote.subtotalMinor, vatMinor: quote.vatMinor, totalMinor: quote.totalMinor,
  depositMinor: quote.depositMinor, expiresAt: quote.expiresAt.toISOString(), acceptedAt: quote.acceptedAt?.toISOString() ?? null,
  converted: Boolean(quote.jobId), balanceMinor: Math.max(0, quote.totalMinor - quote.depositMinor), pricing: quote.pricingSnapshot, recommendation: quote.recommendation,
});
export function staffQuote(quote: typeof customerQuotes.$inferSelect) {
  const { accessTokenHash, ...record } = quote;
  void accessTokenHash;
  return record;
}
export function calculateQuoteMoney(baseAmountMinor: number, vatBasisPoints: number, depositBasisPoints: number, surcharges: Array<{ amountMinor: number }>) {
  return quoteMoney(baseAmountMinor, vatBasisPoints, depositBasisPoints, surcharges);
}

export async function resolvePublicOrganisation(request: Request, requestedSlug?: string) {
  const db = createDatabase();
  const hostname = new URL(request.url).hostname.toLowerCase();
  const [record] = requestedSlug
    ? await db.select({ id: organisations.id, slug: organisations.slug, name: organisations.name }).from(organisations).where(and(eq(organisations.slug, requestedSlug), eq(organisations.status, "active"))).limit(1)
    : await db.select({ id: organisations.id, slug: organisations.slug, name: organisations.name }).from(organisationDomains).innerJoin(organisations, eq(organisationDomains.organisationId, organisations.id)).where(and(eq(organisationDomains.hostname, hostname), eq(organisations.status, "active"), sql`${organisationDomains.verifiedAt} is not null`)).limit(1);
  if(record&&await isDemoOrganisation(record.id,db)){
    const context=await apiContext(request);
    if(!context||context.demo||context.organisationId!==record.id)return null;
  }
  return record ?? null;
}

export async function createPublicQuote(input: { organisationId: string; requestId: string; actorUserId?:string;workspaceMode?:WorkspaceMode;actorRole?:OrganisationRole; serviceId?: string; firstName?: string; lastName?: string; email?: string; phone?: string; answers?: Record<string, unknown>; surchargeKeys?: string[]; websiteSubmission?: FormSubmission }) {
  const db = createDatabase();
  const demo = await isDemoOrganisation(input.organisationId, db);
  const rawToken = demo ? randomBytes(32).toString("base64url") : tokenForRequest(input.organisationId, input.requestId);
  return withTenant(db, input.organisationId, async (tx) => {
    if (input.websiteSubmission) {
      const { requireLoadedForm } = await import("./website-form");
      await requireLoadedForm(tx, input.organisationId, { ...input.websiteSubmission, serviceId: input.serviceId });
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`website-submission:${input.organisationId}:${input.requestId}`}))`);
      const [enquiry] = await tx.select({ id: websiteEnquiries.id }).from(websiteEnquiries).where(and(eq(websiteEnquiries.organisationId, input.organisationId), eq(websiteEnquiries.requestId, input.requestId))).limit(1);
      if (enquiry) throw new Error("WEBSITE_REQUEST_ALREADY_SUBMITTED");
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`quote:${input.organisationId}:${input.requestId}`}))`);
    const [duplicate] = await tx.select().from(customerQuotes).where(and(eq(customerQuotes.organisationId, input.organisationId), eq(customerQuotes.publicRequestId, input.requestId))).limit(1);
    if (duplicate) {
      if (input.websiteSubmission && (!isDeepStrictEqual(duplicate.answers, input.answers) || duplicate.firstName !== input.firstName || duplicate.lastName !== input.lastName || duplicate.email !== input.email?.toLowerCase() || duplicate.phone !== input.phone)) throw new Error("QUOTE_REQUEST_CHANGED");
      if (demo) await tx.update(customerQuotes).set({ accessTokenHash: tokenHash(rawToken) }).where(eq(customerQuotes.id, duplicate.id));
      return { quote: publicQuote(duplicate), token: rawToken, duplicate: true };
    }
    const [settings, selected, catalogue] = await Promise.all([
      tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, input.organisationId)).limit(1).then((rows) => rows[0]),
      input.serviceId ? tx.select({ service: serviceDefinitions, pricing: servicePricingVersions }).from(serviceDefinitions).innerJoin(servicePricingVersions, and(eq(servicePricingVersions.serviceDefinitionId, serviceDefinitions.id), eq(servicePricingVersions.active, true))).where(and(eq(serviceDefinitions.id, input.serviceId), eq(serviceDefinitions.organisationId, input.organisationId), eq(serviceDefinitions.active, true))).orderBy(desc(servicePricingVersions.version)).limit(1).then((rows) => rows[0]) : Promise.resolve(undefined),
      tx.select({ service: serviceDefinitions, pricing: servicePricingVersions }).from(serviceDefinitions).innerJoin(servicePricingVersions, and(eq(servicePricingVersions.serviceDefinitionId, serviceDefinitions.id), eq(servicePricingVersions.active, true))).where(and(eq(serviceDefinitions.organisationId, input.organisationId), eq(serviceDefinitions.active, true))).orderBy(desc(servicePricingVersions.version)),
    ]);
    if (!settings?.publicQuotesEnabled && !input.actorUserId) throw new Error("PUBLIC_QUOTES_DISABLED");
    const recommendation = recommendCliftonService(input.answers ?? {});
    const recommended = !input.serviceId ? selectRecommendedService(catalogue,input.answers??{}) : undefined;
    const service = selected?.service ?? recommended?.service; const pricing = selected?.pricing ?? recommended?.pricing;
    if (!service || !pricing) throw new Error("SERVICE_UNAVAILABLE");
    const surchargeEntries = Object.entries(pricing.surcharges).filter(([key]) => input.surchargeKeys?.includes(key));
    const { subtotalMinor, vatMinor, totalMinor, depositMinor } = calculateQuoteMoney(pricing.baseAmountMinor, pricing.vatBasisPoints, pricing.depositBasisPoints, surchargeEntries.map(([, value]) => value));
    const expiresAt = new Date(Date.now() + pricing.validityDays * 86_400_000);
    const reference = `SVQ-${new Date().getUTCFullYear()}-${randomBytes(5).toString("hex").toUpperCase()}`;
    const snapshot = { service: service.name, pricingVersion: pricing.version, baseAmountMinor: pricing.baseAmountMinor, surcharges: Object.fromEntries(surchargeEntries), vatBasisPoints: pricing.vatBasisPoints, depositBasisPoints: pricing.depositBasisPoints, durationMinutes: pricing.durationMinutes };
    const [quote] = await tx.insert(customerQuotes).values({ organisationId: input.organisationId, publicRequestId: input.requestId, serviceDefinitionId: service.id, pricingVersionId: pricing.id, reference, status: input.email ? "issued" : "draft", firstName: input.firstName, lastName: input.lastName, email: input.email?.toLowerCase(), phone: input.phone, propertyAddress: input.websiteSubmission ? [input.websiteSubmission.address.line1, input.websiteSubmission.address.line2, input.websiteSubmission.address.city, input.websiteSubmission.address.postcode].filter(Boolean).join(", ") : undefined, answers: input.answers ?? {}, recommendation: { serviceId: service.id, serviceName: service.name, basis: input.serviceId ? "customer_selected" : "clifton_adviser_v1", reason: input.websiteSubmission && pricing.recommendationRules.source !== "clifton_adviser_v1" ? "You selected this service. The practice will confirm its suitability and agreed scope." : recommendation.reason }, pricingSnapshot: snapshot, currency: pricing.currency, subtotalMinor, vatMinor, totalMinor, depositMinor, accessTokenHash: tokenHash(rawToken), expiresAt, issuedAt: input.email ? new Date() : null }).returning();
    await tx.insert(quoteSnapshots).values({ organisationId: input.organisationId, quoteId: quote.id, event: "created", snapshot: publicQuote(quote) });
    await tx.insert(auditEvents).values(workspaceAudit(input,{ organisationId: input.organisationId,actorUserId:input.actorUserId??null, action: "quote.created", resourceType: "quote", resourceId: quote.id, metadata: { reference, serviceId: service.id } }));
    return { quote: publicQuote(quote), token: rawToken };
  });
}

export async function readPublicQuote(id: string, token: string) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("PUBLIC_QUOTE_STORAGE_UNAVAILABLE");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [quote] = await db.select().from(customerQuotes).where(and(eq(customerQuotes.id, id), eq(customerQuotes.accessTokenHash, tokenHash(token)), isNull(customerQuotes.tokenRevokedAt))).limit(1);
  if (!quote) return null;
  const [organisation] = await db.select({ status: organisations.status, demo: organisations.isDemo }).from(organisations).where(eq(organisations.id, quote.organisationId)).limit(1);
  if (!organisation || organisation.status !== "active") return null;
  if (quote.status !== "converted" && quote.status !== "cancelled" && quote.expiresAt < new Date()) {
    await db.update(customerQuotes).set({ status: "expired", updatedAt: new Date(), version: quote.version + 1 }).where(and(eq(customerQuotes.id, quote.id), eq(customerQuotes.version, quote.version)));
    quote.status = "expired";
  }
  const verifiedPayments=await db.select().from(clientPayments).where(and(eq(clientPayments.quoteId,quote.id),eq(clientPayments.organisationId,quote.organisationId),inArray(clientPayments.status,["succeeded","partially_refunded","refunded"])));
  const received=(purpose:string)=>verifiedPayments.filter(payment=>(payment.purpose===purpose || payment.purpose===`manual_${purpose}`)).reduce((sum,payment)=>sum+payment.amountMinor-payment.refundedMinor,0);
  const [appointment]=await db.select({id:appointments.id,status:appointments.status,startsAt:appointments.startsAt,endsAt:appointments.endsAt}).from(appointments).where(and(eq(appointments.quoteId,quote.id),eq(appointments.organisationId,quote.organisationId))).limit(1);
  const customerInvoices=await db.select({id:invoices.id,number:invoices.number,status:invoices.status,currency:invoices.currency,totalMinor:invoices.totalMinor,creditedMinor:sql<number>`coalesce((select sum(c.amount_minor) from invoice_credits c where c.invoice_id=invoices.id and c.organisation_id=${quote.organisationId}),0)::bigint`,dueAt:invoices.dueAt}).from(invoices).where(and(eq(invoices.quoteId,quote.id),eq(invoices.organisationId,quote.organisationId)));
  const balanceCredits=customerInvoices.filter(i=>i.number.endsWith("-B")).reduce((sum,i)=>sum+Number(i.creditedMinor),0);
  const depositCredits=customerInvoices.filter(i=>i.number.endsWith("-D")).reduce((sum,i)=>sum+Number(i.creditedMinor),0);
  const balanceMinor=Math.max(0,quote.totalMinor-quote.depositMinor-balanceCredits-received("balance"));
  return { row: quote, view: { ...publicQuote(quote), balanceMinor,balancePaid:balanceMinor===0,manualBalanceReceived:verifiedPayments.filter(payment=>payment.purpose==="manual_balance").reduce((sum,payment)=>sum+payment.amountMinor-payment.refundedMinor,0),depositPaid:received("deposit")+depositCredits>=quote.depositMinor, demo: organisation.demo,appointment:appointment??null,invoices:customerInvoices } };
}

export async function acceptQuoteAddress(id: string, token: string, address: { line1: string; city: string; postcode: string }) {
  const found = await readPublicQuote(id, token);
  if (!found || found.row.status === "expired" || found.row.status === "cancelled") return null;
  if (found.row.jobId) return { row: found.row, view: publicQuote(found.row) };
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const propertyAddress = `${address.line1}, ${address.city}, ${address.postcode.toUpperCase()}`;
  const [updated] = await db.update(customerQuotes).set({ propertyAddress, city: address.city, postcode: address.postcode.toUpperCase(), status: "accepted", acceptedAt: found.row.acceptedAt ?? new Date(), updatedAt: new Date(), version: found.row.version + 1 }).where(and(eq(customerQuotes.id, id), eq(customerQuotes.version, found.row.version))).returning();
  if (!updated) throw new Error("QUOTE_CHANGED");
  await db.insert(quoteSnapshots).values({ organisationId: updated.organisationId, quoteId: updated.id, event: "accepted", snapshot: publicQuote(updated) });
  await db.insert(auditEvents).values({ organisationId: updated.organisationId, action: "quote.accepted", resourceType: "quote", resourceId: updated.id, metadata: { reference: updated.reference } });
  return { row: updated, view: publicQuote(updated) };
}

export async function createPendingDeposit(quote: typeof customerQuotes.$inferSelect) {
  return createPendingQuotePayment(quote,"deposit");
}

export async function createPendingBalance(quote: typeof customerQuotes.$inferSelect) {
  if(!quote.jobId)throw new Error("PAYMENTS_UNAVAILABLE");
  return createPendingQuotePayment(quote,"balance");
}

async function createPendingQuotePayment(quote:typeof customerQuotes.$inferSelect,purpose:"deposit"|"balance"){
  if(!process.env.DATABASE_ADMIN_URL)throw new Error("PAYMENTS_UNAVAILABLE");
  const amountMinor=purpose==="deposit"?quote.depositMinor:Math.max(0,quote.totalMinor-quote.depositMinor);
  if(amountMinor<=0)throw new Error("NO_BALANCE_DUE");
  return createDatabase(process.env.DATABASE_ADMIN_URL).transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`quote-payment:${quote.organisationId}:${quote.id}:${purpose}`}))`);
    const invoice = await ensureQuoteInvoice(tx, quote, purpose);
    const [existing]=await tx.select({payment:clientPayments,invoice:invoices}).from(clientPayments).innerJoin(invoices,eq(clientPayments.invoiceId,invoices.id)).where(and(eq(clientPayments.organisationId,quote.organisationId),eq(clientPayments.quoteId,quote.id),eq(clientPayments.purpose,purpose),or(eq(clientPayments.status,"pending"),isNotNull(clientPayments.succeededAt)))).orderBy(desc(clientPayments.createdAt)).limit(1);
    const balance=await invoiceBalance(tx,invoice);
    if(existing?.payment.succeededAt)return existing;
    if(balance.outstandingMinor<=0)throw new Error("NO_BALANCE_DUE");
    if(existing){
      if(existing.payment.stripeCheckoutSessionId && existing.payment.amountMinor!==balance.outstandingMinor)throw new Error("CHECKOUT_AMOUNT_CHANGED");
      if(existing.payment.amountMinor!==balance.outstandingMinor){const [updated]=await tx.update(clientPayments).set({amountMinor:balance.outstandingMinor,updatedAt:new Date()}).where(eq(clientPayments.id,existing.payment.id)).returning();return{invoice,payment:updated};}
      return existing;
    }
    const [payment]=await tx.insert(clientPayments).values({organisationId:quote.organisationId,invoiceId:invoice.id,quoteId:quote.id,purpose,currency:invoice.currency,amountMinor:balance.outstandingMinor}).returning();
    return{invoice,payment};
  });
}

/** Issue the deposit/balance from its accepted pricing snapshot without reserving processor payment. */
export async function ensureQuoteInvoice(tx: TenantTransaction, quote: typeof customerQuotes.$inferSelect, purpose: "deposit" | "balance") {
  const amountMinor = purpose === "deposit" ? quote.depositMinor : Math.max(0, quote.totalMinor-quote.depositMinor);
  if (amountMinor <= 0) throw new Error("NO_BALANCE_DUE");
  const number = `${quote.reference}-${purpose === "deposit" ? "D" : "B"}`;
  let [invoice]=await tx.select().from(invoices).where(and(eq(invoices.organisationId,quote.organisationId),eq(invoices.quoteId,quote.id),eq(invoices.number,number))).for("update").limit(1);
  if(invoice?.status==="void")throw new Error("INVOICE_VOID");
  if(!invoice){
    // Allocate VAT proportionately from the immutable quote, preserving its rounding.
    const vatMinor=purpose==="deposit"?Math.round(quote.vatMinor*amountMinor/quote.totalMinor):quote.vatMinor-Math.round(quote.vatMinor*quote.depositMinor/quote.totalMinor);
    [invoice]=await tx.insert(invoices).values({organisationId:quote.organisationId,jobId:quote.jobId,quoteId:quote.id,number,status:"open",currency:quote.currency,subtotalMinor:amountMinor-vatMinor,vatMinor,totalMinor:amountMinor,dueAt:purpose==="deposit"?quote.expiresAt:new Date(Date.now()+14*86400000),issuedAt:new Date()}).returning();
    await tx.insert(invoiceLineItems).values({organisationId:quote.organisationId,invoiceId:invoice.id,description:`${purpose} for ${String(quote.pricingSnapshot.service??"survey")}`,unitAmountMinor:invoice.subtotalMinor,vatBasisPoints:Number(quote.pricingSnapshot.vatBasisPoints??0)});
    await tx.insert(auditEvents).values({organisationId:quote.organisationId,action:`invoice.${purpose}_issued`,resourceType:"invoice",resourceId:invoice.id,metadata:{quoteId:quote.id,amountMinor}});
  }
  return invoice;
}

export async function settleBalancePayment(input: { paymentId: string; checkoutSessionId: string; paymentIntentId: string | null }) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required."); const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  return db.transaction(async tx=>{
    const [record]=await tx.select({payment:clientPayments,invoice:invoices}).from(clientPayments).innerJoin(invoices,eq(clientPayments.invoiceId,invoices.id)).where(eq(clientPayments.id,input.paymentId)).for("update").limit(1);
    if(!record||record.payment.purpose!=="balance")throw new Error("Balance payment was not found.");
    if(record.payment.succeededAt)return record.invoice.jobId;
    const status=verifiedPaymentStatus(record.payment.amountMinor,record.payment.refundedMinor);
    await tx.update(clientPayments).set({status,stripeCheckoutSessionId:input.checkoutSessionId,stripePaymentIntentId:input.paymentIntentId,succeededAt:new Date(),updatedAt:new Date()}).where(eq(clientPayments.id,record.payment.id));
    await refreshInvoiceBalance(tx,record.invoice);
    await tx.insert(settlementLedger).values({organisationId:record.payment.organisationId,paymentId:record.payment.id,entryType:"firm_liability",currency:record.payment.currency,amountMinor:record.payment.amountMinor,metadata:{jobId:record.invoice.jobId,purpose:"balance"}});
    await tx.insert(auditEvents).values({organisationId:record.payment.organisationId,action:"client_payment.balance_succeeded",resourceType:"client_payment",resourceId:record.payment.id,metadata:{invoiceId:record.invoice.id}});
    return record.invoice.jobId;
  });
}

export function verifiedPaymentStatus(amountMinor:number,refundedMinor:number){return refundedMinor>=amountMinor?"refunded" as const:refundedMinor>0?"partially_refunded" as const:"succeeded" as const;}

export async function convertPaidQuote(input: { paymentId: string; checkoutSessionId: string; paymentIntentId: string | null }) {
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  return db.transaction(async (tx) => {
    const [record] = await tx.select({ payment: clientPayments, invoice: invoices, quote: customerQuotes }).from(clientPayments).innerJoin(invoices, eq(clientPayments.invoiceId, invoices.id)).innerJoin(customerQuotes, eq(clientPayments.quoteId, customerQuotes.id)).where(eq(clientPayments.id, input.paymentId)).for("update").limit(1);
    if (!record || record.payment.purpose !== "deposit") throw new Error("Deposit payment was not found.");
    if (record.payment.succeededAt && record.quote.jobId) return record.quote.jobId;
    if (record.quote.jobId) throw new Error("Quote has already been converted.");
    const jobId = await instructPaidQuote(tx, record.quote, record.invoice.id, record.payment.id);
    await tx.update(clientPayments).set({ status: verifiedPaymentStatus(record.payment.amountMinor,record.payment.refundedMinor), stripeCheckoutSessionId: input.checkoutSessionId, stripePaymentIntentId: input.paymentIntentId, succeededAt: new Date(), updatedAt: new Date() }).where(eq(clientPayments.id, record.payment.id));
    await refreshInvoiceBalance(tx,record.invoice);
    await tx.insert(settlementLedger).values({ organisationId: record.quote.organisationId, paymentId: record.payment.id, entryType: "firm_liability", currency: record.quote.currency, amountMinor: record.payment.amountMinor, metadata: { quoteId: record.quote.id, jobId } });
    return jobId;
  });
}

/** Caller holds the quote and deposit invoice locks; receipt verification stays in its transaction. */
export async function instructPaidQuote(tx: TenantTransaction, quote: typeof customerQuotes.$inferSelect, invoiceId: string, paymentId: string, actorUserId?: string) {
  const [existingClient]=quote.clientId?await tx.select().from(clients).where(and(eq(clients.id,quote.clientId),eq(clients.organisationId,quote.organisationId))).limit(1):[];
  const client=existingClient??(await tx.insert(clients).values({ organisationId: quote.organisationId, kind: "individual", displayName: [quote.firstName, quote.lastName].filter(Boolean).join(" ") || quote.email || quote.reference, email: quote.email, phone: quote.phone }).returning())[0];
  const addressParts = (quote.propertyAddress ?? "Address pending").split(",").map((part) => part.trim());
  const reportedAddress = propertyAddressSchema.safeParse(quote.answers.address).data;
  const [existingProperty]=quote.propertyId?await tx.select().from(properties).where(and(eq(properties.id,quote.propertyId),eq(properties.organisationId,quote.organisationId),eq(properties.clientId,client.id))).limit(1):[];
  const property=existingProperty??(await tx.insert(properties).values({ organisationId: quote.organisationId, clientId: client.id, line1: addressParts[0] || "Address pending", line2: reportedAddress && addressParts[0] === reportedAddress.line1 ? reportedAddress.line2 : undefined, city: quote.city || reportedAddress?.city || addressParts.at(-2) || "Unknown", postcode: quote.postcode || reportedAddress?.postcode || "UNKNOWN", country: reportedAddress?.country ?? "ENG", propertyType: typeof quote.answers.reportedPropertyType === "string" ? quote.answers.reportedPropertyType.slice(0, 100) : undefined, addressSource: "customer_quote" }).returning())[0];
  const [job] = await tx.insert(jobs).values({ organisationId: quote.organisationId, clientId: client.id, propertyId: property.id, reference: quote.reference.replace("SVQ", "SVJ"), serviceName: String((quote.pricingSnapshot as Record<string, unknown>).service ?? "Survey"), stage: "instructed", fee: (quote.totalMinor / 100).toFixed(2), notes: `Customer quote ${quote.reference}; customer statements remain unverified.` }).returning();
  await tx.update(customerQuotes).set({ status: "converted", clientId: client.id, propertyId: property.id, jobId: job.id, updatedAt: new Date(), version: quote.version + 1 }).where(eq(customerQuotes.id, quote.id));
  await tx.update(invoices).set({ jobId: job.id, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
  await tx.insert(quoteSnapshots).values({ organisationId: quote.organisationId, quoteId: quote.id, event: "converted", snapshot: { ...publicQuote({ ...quote, status: "converted", clientId: client.id, propertyId: property.id, jobId: job.id }), clientId: client.id, propertyId: property.id, jobId: job.id } });
  await tx.insert(auditEvents).values({ organisationId: quote.organisationId, actorUserId, action: "quote.converted", resourceType: "job", resourceId: job.id, metadata: { quoteId: quote.id, paymentId: paymentId } });
  return job.id;
}

export async function listFirmOperations(organisationId: string, viewer?: { role: OrganisationRole; userId: string | null }) {
  const db = createDatabase();
  if (viewer?.role === "surveyor") return withTenant(db, organisationId, async tx => {
    const [scheduled, documents] = await Promise.all([
      tx.select().from(appointments).where(and(eq(appointments.organisationId, organisationId), eq(appointments.surveyorId, viewer.userId!), sql`exists (select 1 from jobs j where j.id = ${appointments.jobId} and j.organisation_id = ${organisationId} and j.assigned_surveyor_id = ${viewer.userId})`)).orderBy(asc(appointments.startsAt)).limit(200),
      tx.select({ id: organisationDocuments.id, name: organisationDocuments.name, category: organisationDocuments.category, accessClass: organisationDocuments.accessClass, checksum: organisationDocuments.checksum, sizeBytes: organisationDocuments.sizeBytes, legalHold: organisationDocuments.legalHold, retentionUntil: organisationDocuments.retentionUntil, createdAt: organisationDocuments.createdAt }).from(organisationDocuments).where(and(eq(organisationDocuments.organisationId, organisationId), isNull(organisationDocuments.deletedAt), documentAccess(viewer.role, viewer.userId))).limit(200),
    ]);
    return { quotes: [], appointments: scheduled, finance: [], documents, totals: { quotes: 0, converted: 0, receipts: 0, outstanding: 0, invoices: 0, currencies: [] } };
  });
  const { accessTokenHash, ...staffQuoteColumns } = getTableColumns(customerQuotes);
  void accessTokenHash; // Token verifiers are never sent to staff browser components.
  return withTenant(db, organisationId, async (tx) => {
    const [quotes, scheduled, documents, totals] = await Promise.all([
      tx.select(staffQuoteColumns).from(customerQuotes).where(eq(customerQuotes.organisationId, organisationId)).orderBy(desc(customerQuotes.updatedAt)).limit(100),
      tx.select().from(appointments).where(and(eq(appointments.organisationId, organisationId), gt(appointments.endsAt, new Date(Date.now() - 31 * 86_400_000)))).orderBy(asc(appointments.startsAt)).limit(200),
      tx.select({ id: organisationDocuments.id, name: organisationDocuments.name, category: organisationDocuments.category, accessClass: organisationDocuments.accessClass, checksum: organisationDocuments.checksum, sizeBytes: organisationDocuments.sizeBytes, legalHold: organisationDocuments.legalHold, retentionUntil: organisationDocuments.retentionUntil, createdAt: organisationDocuments.createdAt }).from(organisationDocuments).where(and(eq(organisationDocuments.organisationId, organisationId), isNull(organisationDocuments.deletedAt), viewer ? documentAccess(viewer.role, viewer.userId) : undefined)).orderBy(desc(organisationDocuments.createdAt)).limit(200),
      tx.execute(sql`with paid as (select invoice_id, sum(amount_minor-refunded_minor)::bigint net from client_payments where organisation_id=${organisationId} and status in ('succeeded','partially_refunded','refunded') group by invoice_id) select (select count(*)::int from customer_quotes where organisation_id=${organisationId}) quotes, (select count(*)::int from customer_quotes where organisation_id=${organisationId} and status='converted') converted, (select coalesce(sum(net),0)::bigint from paid) receipts, coalesce(sum(case when i.status not in ('void','draft') then greatest(0,i.total_minor-coalesce((select sum(c.amount_minor) from invoice_credits c where c.invoice_id=i.id and c.organisation_id=i.organisation_id),0)-coalesce(p.net,0)) else 0 end),0)::bigint outstanding, count(*)::int invoices from invoices i left join paid p on p.invoice_id=i.id where i.organisation_id=${organisationId}`),
    ]);
    // Paginate invoices before joining their complete payment history; a payment must never duplicate an invoice.
    const invoiceRows = await tx.select().from(invoices).where(eq(invoices.organisationId, organisationId)).orderBy(desc(invoices.createdAt)).limit(100);
    const currencyTotals = await tx.execute(sql`with paid as (
      select invoice_id, sum(amount_minor-refunded_minor)::bigint net from client_payments
      where organisation_id=${organisationId} and status in ('succeeded','partially_refunded','refunded') group by invoice_id
    ) select i.currency, coalesce(sum(p.net),0)::bigint receipts,
      coalesce(sum(case when i.status not in ('void','draft') then greatest(0,i.total_minor-coalesce((select sum(c.amount_minor) from invoice_credits c where c.invoice_id=i.id and c.organisation_id=i.organisation_id),0)-coalesce(p.net,0)) else 0 end),0)::bigint outstanding,
      count(*)::int invoices from invoices i left join paid p on p.invoice_id=i.id where i.organisation_id=${organisationId} group by i.currency order by i.currency`);
    const paymentRows = invoiceRows.length ? await tx.select().from(clientPayments).where(and(eq(clientPayments.organisationId, organisationId),inArray(clientPayments.invoiceId,invoiceRows.map(row=>row.id)))).orderBy(asc(clientPayments.createdAt)) : [];
    const creditRows = invoiceRows.length ? await tx.select().from(invoiceCredits).where(and(eq(invoiceCredits.organisationId,organisationId),inArray(invoiceCredits.invoiceId,invoiceRows.map(row=>row.id)))) : [];
    const finance = invoiceRows.map(invoice => {
      const payments = paymentRows.filter(p => p.invoiceId === invoice.id);
      const paidMinor = payments.filter(p => ["succeeded","partially_refunded","refunded"].includes(p.status)).reduce((n,p)=>n+p.amountMinor-p.refundedMinor,0);
      const creditedMinor = creditRows.filter(c=>c.invoiceId===invoice.id).reduce((sum,c)=>sum+c.amountMinor,0);
      return { invoice, creditedMinor, adjustedTotalMinor:invoice.totalMinor-creditedMinor, payment: payments.at(-1) ?? null, payments, paidMinor, outstandingMinor: ["void","draft"].includes(invoice.status)?0:Math.max(0,invoice.totalMinor-creditedMinor-paidMinor) };
    });
    const row = totals.rows[0] as Record<string,unknown>;
    return { quotes: viewer?.role === "finance" ? [] : quotes, appointments: viewer?.role === "finance" ? [] : scheduled, finance, documents: viewer?.role === "finance" ? [] : documents, totals: { quotes:Number(row.quotes), converted:Number(row.converted), receipts:Number(row.receipts), outstanding:Number(row.outstanding), invoices:Number(row.invoices), currencies:currencyTotals.rows.map(row=>({currency:String(row.currency),receipts:Number(row.receipts),outstanding:Number(row.outstanding),invoices:Number(row.invoices)})) } };
  });
}
export type FirmOperationsData = Awaited<ReturnType<typeof listFirmOperations>>;
