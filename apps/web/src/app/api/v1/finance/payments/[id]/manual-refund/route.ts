import { and, eq } from "drizzle-orm";
import { clientPayments, createDatabase, withTenant } from "@surveynt/db";
import { canManageFinance } from "@surveynt/domain";
import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { manualReviewSchema, recordManualReview } from "@/lib/manual-finance";

export async function POST(request: Request, route: RouteContext<"/api/v1/finance/payments/[id]/manual-refund">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in to verify an external refund.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (!canWriteWorkspace(context) || !canManageFinance(context.role) || context.demo) return problem(403, "forbidden", "A finance reviewer in a writable authenticated practice is required.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "payment_not_found", "Payment not found.");
  const parsed = await parseBody(request, manualReviewSchema);
  if (!parsed.success) return problem(400, "invalid_request", "Review the completed refund, reference, evidence and confirmation.", parsed.error.flatten());
  const [payment] = await withTenant(createDatabase(), context.organisationId, tx => tx.select({ invoiceId: clientPayments.invoiceId }).from(clientPayments).where(and(eq(clientPayments.id, id), eq(clientPayments.organisationId, context.organisationId))).limit(1));
  if (!payment) return problem(404, "payment_not_found", "Payment not found.");
  return recordManualReview(context, payment.invoiceId, parsed.data, id);
}
