import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import {
  auditEvents,
  createDatabase,
  organisationBranding,
  organisations,
} from "@surveynt/db";
import { platformApiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
const input = z.object({
  name: z.string().trim().min(2).max(160),
  tradingName: z.string().trim().min(2).max(160),
  region: z.string().trim().min(2).max(100),
  practiceType: z.enum([
    "residential-building-surveying",
    "commercial-building-surveying",
    "valuation",
    "multi-disciplinary",
  ]),
  supportEmail: z.union([z.email(), z.literal("")]),
});
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const context = await platformApiContext();
  if (!context)
    return problem(401, "unauthorised", "Platform access required.");
  if (context.role !== "super_admin")
    return problem(
      403,
      "forbidden",
      "Only super administrators edit customer accounts.",
    );
  const { tenantId } = await params;
  const parsed = await parseBody(request, input);
  if (!z.uuid().safeParse(tenantId).success || !parsed.success)
    return problem(422, "invalid_customer", "Check customer account details.");
  if (context.demo)
    return problem(
      409,
      "preview_only",
      "Account editing requires the connected database.",
    );
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`customer:${tenantId}`},0))`,
      );
      const [org] = await tx
        .select()
        .from(organisations)
        .where(eq(organisations.id, tenantId));
      if (!org) return null;
      await (
        await clerkClient()
      ).organizations.updateOrganization(org.clerkOrganisationId, {
        name: parsed.data.name,
      });
      await tx
        .update(organisations)
        .set({
          name: parsed.data.name,
          region: parsed.data.region,
          practiceType: parsed.data.practiceType,
          updatedAt: new Date(),
        })
        .where(eq(organisations.id, tenantId));
      await tx
        .insert(organisationBranding)
        .values({
          organisationId: tenantId,
          tradingName: parsed.data.tradingName,
          supportEmail: parsed.data.supportEmail,
        })
        .onConflictDoUpdate({
          target: organisationBranding.organisationId,
          set: {
            tradingName: parsed.data.tradingName,
            supportEmail: parsed.data.supportEmail,
            updatedAt: new Date(),
          },
        });
      await tx
        .insert(auditEvents)
        .values({
          organisationId: tenantId,
          platformStaffId: context.platformStaffId,
          action: "customer.details_updated",
          resourceType: "organisation",
          resourceId: tenantId,
          metadata: {
            previous: {
              name: org.name,
              region: org.region,
              practiceType: org.practiceType,
            },
            changedFields: Object.keys(parsed.data),
          },
        });
      return { id: tenantId };
    });
    return result
      ? ok(result)
      : problem(404, "not_found", "Customer not found.");
  } catch {
    return problem(
      503,
      "update_incomplete",
      "Customer update could not complete. Retry to reconcile both systems.",
    );
  }
}
