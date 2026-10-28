import { apiContext, isClerkConfigured } from "@/lib/access";
import { recordWorkspaceVisit } from "@/lib/customer-followups";
export async function POST(request: Request) {
  if (!isClerkConfigured()) return new Response(null, { status: 204 });
  try {
    const context = await apiContext(request);
    if (!context || context.demo || !context.internalUserId)
      return new Response(null, { status: 401 });
    await recordWorkspaceVisit({
      ...context,
      internalUserId: context.internalUserId,
    });
  } catch {
    console.warn("Customer workspace visit could not be recorded.");
  }
  return new Response(null, { status: 204 });
}
