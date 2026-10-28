import { z } from "zod";
import { platformRoles } from "@surveynt/domain";
import { platformApiContext } from "@/lib/access";
import { inviteStaff, listStaffInvitations } from "@/lib/platform-invitations";
import { ok, parseBody, problem } from "@/lib/api";
export async function GET() {
  const c = await platformApiContext();
  if (!c) return problem(401, "unauthorised", "Platform access required.");
  if (c.role !== "super_admin")
    return problem(403, "forbidden", "Super administrator access required.");
  return ok(c.demo ? [] : await listStaffInvitations());
}
export async function POST(request: Request) {
  const c = await platformApiContext();
  if (!c) return problem(401, "unauthorised", "Platform access required.");
  if (c.role !== "super_admin")
    return problem(403, "forbidden", "Only super administrators invite staff.");
  const parsed = await parseBody(
    request,
    z.object({ email: z.email(), role: z.enum(platformRoles) }),
  );
  if (!parsed.success)
    return problem(422, "invalid_invitation", "Check the email and role.");
  if (c.demo)
    return problem(
      409,
      "preview_only",
      "Invitations require the connected account service.",
    );
  if (!process.env.CLERK_WEBHOOK_SECRET)
    return problem(
      503,
      "account_sync_unavailable",
      "Configure Clerk account synchronisation before inviting staff.",
    );
  try {
    return ok(
      await inviteStaff(parsed.data.email, parsed.data.role, c.platformStaffId),
    );
  } catch {
    return problem(
      409,
      "invitation_failed",
      "Invitation could not be completed. Retry the same email and role, or revoke an existing invitation before changing its role.",
    );
  }
}
