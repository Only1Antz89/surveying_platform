import { auth, currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { acceptStaffInvitation } from "@/lib/platform-invitations";
import { problem } from "@/lib/api";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return problem(401, "unauthorised", "Sign in to accept the invitation.");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return problem(404, "not_found", "Invitation not found.");
  const user = await currentUser();
  if (!user)
    return problem(401, "unauthorised", "Sign in to accept the invitation.");
  try {
    await acceptStaffInvitation(id, user);
    return Response.redirect(new URL("/platform/tenants", request.url), 303);
  } catch {
    return Response.redirect(
      new URL(`/platform-invitations/${id}?error=unavailable`, request.url),
      303,
    );
  }
}
