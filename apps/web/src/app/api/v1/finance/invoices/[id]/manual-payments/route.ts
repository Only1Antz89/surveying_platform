import { z } from "zod";
import { canManageFinance } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { manualReviewSchema, recordManualReview } from "@/lib/manual-finance";

export async function POST(request: Request, route: RouteContext<"/api/v1/finance/invoices/[id]/manual-payments">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in to verify an external receipt.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (!canWriteWorkspace(context) || !canManageFinance(context.role) || context.demo) return problem(403, "forbidden", "A finance reviewer in a writable authenticated practice is required.");
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "invoice_not_found", "Invoice not found.");
  const parsed = await parseBody(request, manualReviewSchema);
  if (!parsed.success) return problem(400, "invalid_request", "Review the completed payment, reference, evidence and confirmation.", parsed.error.flatten());
  return recordManualReview(context, id, parsed.data);
}
