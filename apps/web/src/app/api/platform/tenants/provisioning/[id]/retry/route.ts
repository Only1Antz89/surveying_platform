import { z } from "zod";
import { and, eq, isNotNull } from "drizzle-orm";
import { createDatabase, customerProvisioning } from "@surveynt/db";
import { platformApiContext } from "@/lib/access";
import { customerInput, provisionCustomer } from "@/lib/customer-provisioning";
import { ok, problem } from "@/lib/api";
export async function POST(
  _r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const c = await platformApiContext();
  if (!c) return problem(401, "unauthorised", "Platform access required.");
  if (c.role !== "super_admin")
    return problem(403, "forbidden", "Super administrator access required.");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return problem(404, "not_found", "Setup request not found.");
  if (c.demo || !process.env.CLERK_WEBHOOK_SECRET)
    return problem(
      503,
      "account_sync_unavailable",
      "Configure Clerk account synchronisation first.",
    );
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [request] = await db
    .select()
    .from(customerProvisioning)
    .where(
      and(
        eq(customerProvisioning.id, id),
        isNotNull(customerProvisioning.requestedBy),
      ),
    );
  if (!request) return problem(404, "not_found", "Setup request not found.");
  const input = customerInput.safeParse(request.input);
  if (!input.success)
    return problem(
      409,
      "invalid_setup",
      "Setup request details are incomplete.",
    );
  try {
    return ok(
      await provisionCustomer(
        input.data,
        { email: request.ownerEmail },
        c.platformStaffId,
      ),
    );
  } catch {
    return problem(
      503,
      "setup_interrupted",
      "Setup interrupted. Review service configuration, then resume again.",
    );
  }
}
