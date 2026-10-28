import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { createDatabase, organisations } from "@surveynt/db";
import { isClerkConfigured } from "@/lib/access";
import {
  customerInput,
  provisionCustomer,
  reconcileInvitedOwner,
  seatsForTeamSize,
} from "@/lib/customer-provisioning";
import { ok, parseBody, problem } from "@/lib/api";
export async function POST(request: Request) {
  if (!isClerkConfigured())
    return problem(
      503,
      "provisioning_unavailable",
      "Workspace provisioning needs configured account sign-in.",
    );
  const session = await auth();
  if (!session.userId)
    return problem(401, "unauthorised", "A verified account is required.");
  const parsed = await parseBody(request, customerInput);
  if (!parsed.success)
    return problem(400, "invalid_request", "Check the practice details.");
  if (!process.env.DATABASE_ADMIN_URL)
    return problem(
      503,
      "provisioning_unavailable",
      "Workspace provisioning is unavailable.",
    );
  const user = await currentUser(),
    email = user?.primaryEmailAddress;
  if (!user || !email || email.verification?.status !== "verified")
    return problem(
      400,
      "verified_email_required",
      "Verify your primary email before creating a workspace.",
    );
  const owner = {
    email: email.emailAddress,
    userId: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
  };
  try {
    const invited = await reconcileInvitedOwner(owner, session.orgId);
    if (invited) return ok(invited);
  } catch {
    return problem(
      503,
      "owner_sync_pending",
      "Owner access could not be confirmed. Retry to reconcile your accepted invitation.",
    );
  }
  if (session.orgId) {
    const db = createDatabase(process.env.DATABASE_ADMIN_URL);
    const [existing] = await db
      .select()
      .from(organisations)
      .where(eq(organisations.clerkOrganisationId, session.orgId))
      .limit(1);
    if (existing)
      return ok({
        ...existing,
        seats: seatsForTeamSize[parsed.data.teamSize],
        existing: true,
      });
  }
  try {
    return ok(
      await provisionCustomer(parsed.data, {
        email: email.emailAddress,
        userId: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
      }),
    );
  } catch {
    return problem(
      503,
      "provisioning_incomplete",
      "Setup was interrupted. Submit the same details to resume safely.",
    );
  }
}
