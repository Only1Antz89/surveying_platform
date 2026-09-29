export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!process.env.QUEUE_CONSUMER_SECRET || authorization !== `Bearer ${process.env.QUEUE_CONSUMER_SECRET}`) return Response.json({ error: "Unauthorised queue delivery." }, { status: 401 });
  const event: unknown = await request.json();
  return Response.json({ accepted: true, event });
}
