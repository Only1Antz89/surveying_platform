import { auth, currentUser } from "@clerk/nextjs/server";
import { isClerkConfigured } from "@/lib/access";
import { recordPracticeVisit } from "@/lib/customer-followups";
export async function POST() {
  if (!isClerkConfigured()) return new Response(null, { status: 204 });
  const session = await auth();
  if (!session.userId) return new Response(null, { status: 401 });
  try {
    const user = await currentUser();
    if (user && user.id === session.userId) await recordPracticeVisit(user);
  } catch {
    console.warn("Customer setup visit could not be recorded.");
  }
  return new Response(null, { status: 204 });
}
