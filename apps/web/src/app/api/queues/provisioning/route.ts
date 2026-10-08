import { POST as provisionClerkEvent } from "@/app/api/webhooks/clerk/route";

/** Internal deliveries retain the original signed Clerk body and Svix headers. */
export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!process.env.QUEUE_CONSUMER_SECRET || authorization !== `Bearer ${process.env.QUEUE_CONSUMER_SECRET}`) return Response.json({ error: "Unauthorised queue delivery." }, { status: 401 });
  // Complete the same verified, transactional provisioning used by direct webhooks.
  // Failed deliveries return a failure response so the queue can retry them.
  return provisionClerkEvent(request);
}
