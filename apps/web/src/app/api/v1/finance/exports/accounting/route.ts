import { z } from "zod";
import { canManageFinance } from "@surveynt/domain";
import { apiContext } from "@/lib/access";
import { problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { accountingExport } from "@/lib/accounting-export";

const parameters = z.object({ format: z.enum(["xero", "quickbooks"]), from: z.iso.date().optional(), to: z.iso.date().optional() });

/** Issued invoices as a CSV in Xero or QuickBooks Online import layout. */
export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in to export financial records.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (!canManageFinance(context.role)) return problem(403, "forbidden", "Finance access is required.");
  if (context.demo) return problem(409, "preview_only", "Use an authenticated practice to export persistent financial records.");
  const parsed = parameters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return problem(400, "invalid_request", "Choose Xero or QuickBooks and valid dates.");
  const from = parsed.data.from ? new Date(`${parsed.data.from}T00:00:00Z`) : undefined, to = parsed.data.to ? new Date(`${parsed.data.to}T00:00:00Z`) : undefined;
  if (from && to && from >= to) return problem(400, "invalid_range", "The end must follow the start date.");
  const { csv } = await accountingExport(context.organisationId, parsed.data.format, { from, to });
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="invoices-${parsed.data.format}${parsed.data.from ? `-${parsed.data.from}` : ""}.csv"`, "cache-control": "private, no-store" } });
}
