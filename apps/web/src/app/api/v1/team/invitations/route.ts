import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { organisationRoles } from "@fieldnote/domain";
import { createDatabase, invitations } from "@fieldnote/db";
import { sql } from "drizzle-orm";
import { apiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

const invitationSchema = z.object({ email: z.email(), role: z.enum(organisationRoles) });

export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const parsed = await parseBody(request, invitationSchema);
  if (!parsed.success) return problem(400, "invalid_request", "The invitation details are invalid.", parsed.error.flatten());
  if (context.demo) return ok({ id: crypto.randomUUID(), ...parsed.data, status: "pending" }, { demo: true, persisted: false });
  const clerk = await clerkClient();
  const role = parsed.data.role === "owner" || parsed.data.role === "administrator" ? "org:admin" : "org:member";
  const invitation = await clerk.organizations.createOrganizationInvitation({ organizationId: context.clerkOrganisationId, emailAddress: parsed.data.email, role, inviterUserId: context.userId, expiresInDays: 14 });
  const db = createDatabase();
  const [created] = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${context.organisationId}, true)`);
    return tx.insert(invitations).values({ organisationId: context.organisationId, clerkInvitationId: invitation.id, email: parsed.data.email, role: parsed.data.role, expiresAt: new Date(Date.now() + 14 * 86400000) }).returning();
  });
  return ok(created);
}
