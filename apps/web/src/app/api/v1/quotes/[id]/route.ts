import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { auditEvents, communicationDeliveries, createDatabase, customerQuotes, quoteSnapshots, withTenant } from "@surveynt/db";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { createHash,randomBytes } from "node:crypto";
import { staffQuote } from "@/lib/firm-operations";

const schema = z.discriminatedUnion("action",[
  z.object({ version: z.number().int().positive(), action: z.enum(["cancel", "revoke_link", "reissue_link"]) }),
  z.object({ version: z.number().int().positive(), action:z.literal("update_contact"), firstName:z.string().trim().min(1).max(80),lastName:z.string().trim().max(80).nullable(),email:z.email(),phone:z.string().trim().max(40).nullable() }),
]);
export async function GET(request: Request, route: RouteContext<"/api/v1/quotes/[id]">) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const { id } = await route.params; if (!z.uuid().safeParse(id).success||context.demo) return problem(404, "not_found", "Quote not found.");
  return withTenant(createDatabase(),context.organisationId,async tx=>{
    const [quote]=await tx.select().from(customerQuotes).where(and(eq(customerQuotes.id,id),eq(customerQuotes.organisationId,context.organisationId))).limit(1);
    if(!quote)return problem(404,"not_found","Quote not found.");
    const deliveries=await tx.select({id:communicationDeliveries.id,recipient:communicationDeliveries.recipient,status:communicationDeliveries.status,attempts:communicationDeliveries.attempts,sentAt:communicationDeliveries.sentAt,createdAt:communicationDeliveries.createdAt}).from(communicationDeliveries).where(and(eq(communicationDeliveries.quoteId,id),eq(communicationDeliveries.organisationId,context.organisationId))).orderBy(desc(communicationDeliveries.createdAt)).limit(20);
    return ok({...staffQuote(quote),deliveries});
  });
}
export async function PATCH(request: Request, route: RouteContext<"/api/v1/quotes/[id]">) { const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required."); if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing quotes."); if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Only owners and administrators can manage customer quote access."); const parsed = await parseBody(request, schema); if (!parsed.success) return problem(400, "invalid_request", "The quote update is invalid."); const { id } = await route.params; if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "Quote not found."); if (context.demo) return ok({ id, version: parsed.data.version + 1 }, { demo: true, persisted: false });
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const token=parsed.data.action==="reissue_link"?randomBytes(32).toString("base64url"):null;
  const result = await withTenant(createDatabase(), context.organisationId, async (tx) => {
    const [current]=await tx.select().from(customerQuotes).where(and(eq(customerQuotes.id,id),eq(customerQuotes.organisationId,context.organisationId),eq(customerQuotes.version,parsed.data.version))).for("update").limit(1);
    if(!current||current.status==="cancelled"||parsed.data.action==="cancel"&&current.jobId)return null;
    if(parsed.data.action==="update_contact"){
      if(current.jobId)return null;
      const email=parsed.data.email.toLowerCase(),changedEmail=email!==current.email;
      const [updated]=await tx.update(customerQuotes).set({firstName:parsed.data.firstName,lastName:parsed.data.lastName,email,phone:parsed.data.phone,version:current.version+1,updatedAt:new Date(),...(changedEmail?{tokenRevokedAt:new Date()}: {})}).where(and(eq(customerQuotes.id,id),eq(customerQuotes.organisationId,context.organisationId))).returning();
      await tx.insert(quoteSnapshots).values({organisationId:context.organisationId,quoteId:id,event:"contact_updated",snapshot:{firstName:updated.firstName,lastName:updated.lastName,email:updated.email,phone:updated.phone,version:updated.version,pricingVersionId:current.pricingVersionId}});
      await tx.insert(auditEvents).values({organisationId:context.organisationId,actorUserId:context.internalUserId,action:"quote.contact_updated",resourceType:"quote",resourceId:id,metadata:{version:updated.version,previousLinkRevoked:changedEmail}});
      return {id,version:updated.version,status:updated.status,previousLinkRevoked:changedEmail};
    }
    const [quote] = await tx.update(customerQuotes).set({ ...(parsed.data.action === "cancel" ? { status: "cancelled" as const } : {}),...(token?{accessTokenHash:createHash("sha256").update(token).digest("hex")}:{}),tokenRevokedAt: token ? null : new Date(), version: parsed.data.version + 1, updatedAt: new Date() }).where(and(eq(customerQuotes.id, id), eq(customerQuotes.organisationId, context.organisationId), eq(customerQuotes.version, parsed.data.version))).returning();
    if (!quote) return null;
    await tx.insert(quoteSnapshots).values({ organisationId: context.organisationId, quoteId: quote.id, event: parsed.data.action, snapshot: { status: quote.status, version: quote.version, tokenRevokedAt: quote.tokenRevokedAt?.toISOString() ?? null } });
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: `quote.${parsed.data.action}`, resourceType: "quote", resourceId: quote.id, metadata: { version: quote.version } });
    return {id:quote.id,version:quote.version,status:quote.status,...(token?{url:`/quote/${quote.id}#${token}`}:{})};
  }); return result ? ok(result) : problem(409, "quote_changed", "The quote changed, was cancelled, or is already converted. Reload and try again."); }
