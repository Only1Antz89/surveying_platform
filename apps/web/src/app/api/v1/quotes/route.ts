import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { customerQuotes, createDatabase, withTenant } from "@surveynt/db";
import { desc, eq } from "drizzle-orm";
import { apiContext,canWriteWorkspace } from "@/lib/access";
import { ok,parseBody,problem } from "@/lib/api";
import { z } from "zod";
import { canMutateOperations } from "@surveynt/domain";
import { createPublicQuote, staffQuote } from "@/lib/firm-operations";
const input=z.object({requestId:z.uuid(),serviceId:z.uuid(),firstName:z.string().trim().min(1).max(80),lastName:z.string().trim().max(80),email:z.email(),phone:z.string().max(40).optional(),answers:z.record(z.string(),z.unknown()).optional()});
export async function POST(request:Request){const c=await apiContext(request);if(!c)return problem(401,"unauthorised","Sign in to create quotes.");const accessDenial=await workspaceApiGuard(request,c);if(accessDenial)return accessDenial;if(!canWriteWorkspace(c)||!canMutateOperations(c.role))return problem(403,"forbidden","Your role cannot create quotes.");if(c.demo||!c.internalUserId)return problem(409,"preview_only","Use the signed-in stakeholder practice for persistent quotes.");const p=await parseBody(request,input);if(!p.success)return problem(400,"invalid_request","Check the customer and service details.");try{const result=await createPublicQuote({organisationId:c.organisationId,actorUserId:c.internalUserId,workspaceMode:c.workspaceMode,actorRole:c.actorRole,...p.data});return ok({...result,url:`/quote/${result.quote.id}#${result.token}`});}catch(e){if((e as Error).message==="QUOTE_TOKEN_SECRET_REQUIRED")return problem(503,"setup_required","Secure live customer links require QUOTE_TOKEN_SECRET. Demo links remain available in the private demo practice.");if((e as Error).message==="SERVICE_UNAVAILABLE")return problem(409,"service_unavailable","Choose an active service with configured pricing.");throw e;}}

export async function GET(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (context.demo) return ok([], { demo: true });
  const rows = await withTenant(createDatabase(), context.organisationId, (tx) => tx.select().from(customerQuotes).where(eq(customerQuotes.organisationId, context.organisationId)).orderBy(desc(customerQuotes.updatedAt)).limit(100));
  return ok(rows.map(staffQuote));
}
