import { GET } from "../src/app/api/cron/property-intelligence/route";

async function main() {
  const secret = process.env.QUEUE_CONSUMER_SECRET ?? process.env.CRON_SECRET;
  if (!secret) throw new Error("QUEUE_CONSUMER_SECRET or CRON_SECRET is required.");

  const rejected = await GET(new Request("http://localhost/api/cron/property-intelligence", { headers: { authorization: "Bearer invalid-verification-token" } }));
  if (rejected.status !== 401) throw new Error("The property-intelligence worker accepted an invalid token.");

  const accepted = await GET(new Request("http://localhost/api/cron/property-intelligence", { headers: { authorization: `Bearer ${secret}` } }));
  const body = await accepted.json() as { ok?: boolean; processing?: { claimed?: number; completed?: number; failed?: number }; error?: string };
  if (accepted.status !== 200 || body.ok !== true || !body.processing) throw new Error(body.error ?? "The authenticated property-intelligence worker check failed.");
  console.log(JSON.stringify({ invalidTokenRejected: true, authenticatedStatus: accepted.status, processing: body.processing }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
