import {workspaceAudit} from "@/lib/workspace-audit";
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditEvents, clientPayments, createDatabase, customerQuotes, invoiceCredits, invoices, withTenant } from "@surveynt/db";
import { canManageFinance } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { invoiceBalance, refreshInvoiceBalance } from "@/lib/invoice-balance";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";

const schema = z.object({ requestId: z.uuid(), amountMinor: z.number().int().positive().max(2147483647), vatMinor: z.number().int().nonnegative().max(2147483647), expectedCreditedMinor: z.number().int().nonnegative(), reason: z.string().trim().min(10).max(2000), evidence: z.string().trim().min(10).max(2000), confirmed: z.literal(true) }).refine(v=>v.vatMinor<=v.amountMinor,"VAT cannot exceed the total credit.");
export async function POST(request: Request, route: RouteContext<"/api/v1/finance/invoices/[id]/credits">) {
  const c = await apiContext(request);
  if (!c) return problem(401,"unauthorised","Sign in to issue a credit note.");
  const denial = await workspaceApiGuard(request,c); if(denial)return denial;
  if(c.demo || !c.internalUserId || !canWriteWorkspace(c) || !canManageFinance(c.role)) return problem(403,"forbidden","An authenticated finance reviewer in a writable practice is required.");
  const {id}=await route.params; if(!z.uuid().safeParse(id).success)return problem(404,"not_found","Invoice not found.");
  const p=await parseBody(request,schema);if(!p.success)return problem(400,"invalid_request","Review the amount, VAT, reason, evidence and confirmation.",p.error.flatten());
  const input=p.data,fingerprint=createHash("sha256").update(JSON.stringify({invoiceId:id,...input})).digest("hex");
  return withTenant(createDatabase(),c.organisationId,async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${c.organisationId}:credit:${input.requestId}`}))`);
    const [invoice]=await tx.select().from(invoices).where(and(eq(invoices.id,id),eq(invoices.organisationId,c.organisationId))).for("update").limit(1);
    if(!invoice)return problem(404,"not_found","Invoice not found.");
    const [existing]=await tx.select().from(invoiceCredits).where(and(eq(invoiceCredits.organisationId,c.organisationId),eq(invoiceCredits.requestId,input.requestId))).limit(1);
    if(existing)return existing.fingerprint===fingerprint?ok(existing,{duplicate:true}):problem(409,"request_changed","A credit request cannot be reused with different details.");
    if(["draft","void"].includes(invoice.status))return problem(409,"not_issued","Only an issued invoice may be credited.");
    if(invoice.quoteId){const [quote]=await tx.select({status:customerQuotes.status}).from(customerQuotes).where(eq(customerQuotes.id,invoice.quoteId)).limit(1);if(quote?.status!=="converted")return problem(409,"instruction_required","Resolve the quote instruction before crediting its deposit invoice.");}
    const [pending]=await tx.select({id:clientPayments.id}).from(clientPayments).where(and(eq(clientPayments.invoiceId,id),eq(clientPayments.status,"pending"),inArray(clientPayments.purpose,["deposit","balance"]))).limit(1);
    if(pending)return problem(409,"checkout_pending","Resolve the open online Checkout before changing the collectible amount.");
    const balance=await invoiceBalance(tx,invoice);
    if(input.expectedCreditedMinor!==balance.creditedMinor)return problem(409,"invoice_changed","Reload the invoice and review existing credits.");
    if(input.amountMinor>invoice.totalMinor-balance.creditedMinor || input.vatMinor>invoice.vatMinor-balance.creditedVatMinor || input.amountMinor-input.vatMinor>invoice.subtotalMinor-balance.creditedMinor+balance.creditedVatMinor)return problem(409,"credit_exceeds_invoice","The credit exceeds the remaining original gross, VAT or net amount.");
    const [credit]=await tx.insert(invoiceCredits).values({organisationId:c.organisationId,invoiceId:id,requestId:input.requestId,number:`CN-${input.requestId.replaceAll("-","").toUpperCase()}`,amountMinor:input.amountMinor,vatMinor:input.vatMinor,reason:input.reason,evidence:input.evidence,fingerprint,issuedByUserId:c.internalUserId!}).returning();
    const updated=await refreshInvoiceBalance(tx,invoice);
    await tx.insert(auditEvents).values(workspaceAudit(c,{organisationId:c.organisationId,actorUserId:c.internalUserId,action:"invoice.credit_issued",resourceType:"invoice_credit",resourceId:credit.id,metadata:{invoiceId:id,number:credit.number,amountMinor:credit.amountMinor,vatMinor:credit.vatMinor,currency:invoice.currency,overpaidMinor:updated.overpaidMinor}}));
    return ok(credit,{fundsTransferred:false,refundRequiredMinor:updated.overpaidMinor});
  });
}
