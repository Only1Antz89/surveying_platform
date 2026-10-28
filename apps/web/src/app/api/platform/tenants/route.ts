import { platformApiContext } from "@/lib/access";
import { loadTenants } from "@/lib/data";
import { filterCustomers, registerQuery } from "@/lib/customer-register";
import {
  manualCustomerInput,
  provisionCustomer,
} from "@/lib/customer-provisioning";
import { ok, parseBody, problem } from "@/lib/api";
export async function GET(request: Request) {
  const context = await platformApiContext();
  if (!context)
    return problem(401, "unauthorised", "Platform access required.");
  const query = registerQuery(new URL(request.url).searchParams);
  const rows = filterCustomers(await loadTenants(), query);
  return ok(rows.slice((query.page - 1) * 20, query.page * 20), {
    total: rows.length,
    page: query.page,
    pageSize: 20,
  });
}
export async function POST(request: Request) {
  const context = await platformApiContext();
  if (!context)
    return problem(401, "unauthorised", "Platform access required.");
  if (context.role !== "super_admin")
    return problem(
      403,
      "forbidden",
      "Only super administrators create customer accounts.",
    );
  const parsed = await parseBody(request, manualCustomerInput);
  if (!parsed.success)
    return problem(
      422,
      "invalid_customer",
      "Check firm details and owner email.",
    );
  if (context.demo)
    return problem(
      409,
      "preview_only",
      "Customer creation requires a connected Clerk account and database.",
    );
  if (!process.env.CLERK_WEBHOOK_SECRET)
    return problem(
      503,
      "account_sync_unavailable",
      "Clerk account synchronisation must be configured before sending owner invitations.",
    );
  try {
    return ok(
      await provisionCustomer(
        parsed.data,
        { email: parsed.data.ownerEmail },
        context.platformStaffId,
      ),
    );
  } catch {
    return problem(
      503,
      "provisioning_incomplete",
      "Provisioning interrupted. Retry the same firm and owner to resume without creating duplicates.",
    );
  }
}
