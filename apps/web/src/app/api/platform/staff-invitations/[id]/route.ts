import { z } from "zod";
import { platformApiContext } from "@/lib/access";
import { inviteStaff, revokeStaffInvitation } from "@/lib/platform-invitations";
import { ok, problem } from "@/lib/api";
async function change(params: Promise<{ id: string }>, resend: boolean) {
  const c = await platformApiContext();
  if (!c) return problem(401, "unauthorised", "Platform access required.");
  if (c.role !== "super_admin")
    return problem(403, "forbidden", "Super administrator access required.");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return problem(404, "not_found", "Invitation not found.");
  if (c.demo)
    return problem(
      409,
      "preview_only",
      "Invitations require connected account services.",
    );
  if (resend && !process.env.CLERK_WEBHOOK_SECRET)
    return problem(
      503,
      "account_sync_unavailable",
      "Configure Clerk account synchronisation first.",
    );
  try {
    const previous = await revokeStaffInvitation(id, c.platformStaffId);
    return ok(
      resend
        ? await inviteStaff(previous.email, previous.role, c.platformStaffId)
        : { id, revoked: true },
    );
  } catch {
    return problem(
      409,
      "invitation_changed",
      "Invitation may have been accepted or delivery failed. Refresh and retry.",
    );
  }
}
export async function DELETE(
  _r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return change(params, false);
}
export async function POST(
  _r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return change(params, true);
}
