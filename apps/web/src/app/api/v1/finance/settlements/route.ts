import { GET as exportFinance } from "../exports/route";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { canManageFinance } from "@surveynt/domain";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { auditEvents, createDatabase, settlementBatchItems, settlementBatches, settlementLedger, withTenant } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const schema = z.object({ reference: z.string().trim().min(3).max(120), ledgerEntryIds: z.array(z.uuid()).min(1).max(1000), settledAt: z.iso.datetime(), expectedTotalMinor: z.number().int().positive(), evidence: z.record(z.string(), z.unknown()).default({}) }).refine(value=>new Set(value.ledgerEntryIds).size===value.ledgerEntryIds.length);
export async function GET(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required."); if (!canManageFinance(context.role)) return problem(403, "forbidden", "Finance access is required."); if (context.demo) return ok([], { demo: true });
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (new URL(request.url).searchParams.get("format") === "csv") { const url = new URL(request.url); url.pathname = "/api/v1/finance/exports"; url.search = "dataset=reconciliation&unsettled=true"; return exportFinance(new Request(url, request)); }
  const rows = await withTenant(createDatabase(), context.organisationId, (tx) => tx.select({ entry: settlementLedger }).from(settlementLedger).leftJoin(settlementBatchItems, eq(settlementBatchItems.ledgerEntryId, settlementLedger.id)).where(and(eq(settlementLedger.organisationId, context.organisationId), isNull(settlementBatchItems.id))));

  return ok(rows.map((row) => row.entry));
}
export async function POST(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required."); if (!canWriteWorkspace(context) || !canManageFinance(context.role)) return problem(403, "forbidden", "Only owners and administrators can record settlements."); const parsed = await parseBody(request, schema); if (!parsed.success) return problem(400, "invalid_request", "The settlement details are invalid.", parsed.error.flatten()); if (context.demo) return ok({ id: crypto.randomUUID() }, { demo: true, persisted: false });
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const result = await withTenant(createDatabase(), context.organisationId, async (tx) => { await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${context.organisationId}:settlements`}))`); const rows = await tx.select({ entry: settlementLedger, itemId: settlementBatchItems.id }).from(settlementLedger).leftJoin(settlementBatchItems, eq(settlementBatchItems.ledgerEntryId, settlementLedger.id)).where(and(eq(settlementLedger.organisationId, context.organisationId), inArray(settlementLedger.id, parsed.data.ledgerEntryIds))); if (rows.length !== parsed.data.ledgerEntryIds.length || rows.some((row) => row.itemId)) return null; const currencies = new Set(rows.map((row) => row.entry.currency)); if (currencies.size !== 1) return null; const totalMinor = rows.reduce((sum, row) => sum + row.entry.amountMinor, 0); if (totalMinor <= 0 || totalMinor !== parsed.data.expectedTotalMinor) return null; const [batch] = await tx.insert(settlementBatches).values({ organisationId: context.organisationId, reference: parsed.data.reference, currency: [...currencies][0]!, totalMinor, settledAt: new Date(parsed.data.settledAt), evidence: parsed.data.evidence, createdByUserId: context.internalUserId }).returning(); await tx.insert(settlementBatchItems).values(rows.map((row) => ({ organisationId: context.organisationId, batchId: batch.id, ledgerEntryId: row.entry.id }))); await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "settlement.recorded", resourceType: "settlement_batch", resourceId: batch.id, metadata: { reference: batch.reference, totalMinor, entryCount: rows.length } }); return batch; });
  return result ? ok(result) : problem(409, "settlement_conflict", "One or more entries are already settled, missing, mixed-currency, or do not produce a positive liability.");
}
