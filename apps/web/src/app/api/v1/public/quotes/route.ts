import { z } from "zod";
import { createPublicQuote, resolvePublicOrganisation } from "@/lib/firm-operations";
import { ok, parseBody, problem } from "@/lib/api";

const schema = z.object({ organisationSlug: z.string().trim().min(2).max(80).optional(), serviceId: z.uuid().optional(), firstName: z.string().trim().min(1).max(80).optional(), lastName: z.string().trim().min(1).max(80).optional(), email: z.email().optional(), phone: z.string().trim().max(40).optional(), answers: z.record(z.string(), z.unknown()).optional(), surchargeKeys: z.array(z.string().max(80)).max(20).optional() });

export async function POST(request: Request) {
  const parsed = await parseBody(request, schema);
  if (!parsed.success) return problem(400, "invalid_request", "The quote request is invalid.", parsed.error.flatten());
  const organisation = await resolvePublicOrganisation(request, parsed.data.organisationSlug);
  if (!organisation) return problem(404, "organisation_not_found", "The quoting practice could not be found.");
  const requestId = request.headers.get("idempotency-key");
  if (!z.uuid().safeParse(requestId).success) return problem(400, "idempotency_key_required", "Send a UUID idempotency key with the quote request.");
  try { return ok(await createPublicQuote({ organisationId: organisation.id, requestId: requestId!, ...parsed.data }), { organisation: { slug: organisation.slug, name: organisation.name } }); }
  catch (error) {
    if ((error as Error).message === "PUBLIC_QUOTES_DISABLED") return problem(409, "quotes_disabled", "Online quotes are not currently available for this practice.");
    if ((error as Error).message === "SERVICE_UNAVAILABLE") return problem(404, "service_not_found", "That service is not available for online quoting.");
    if ((error as Error).message === "QUOTE_TOKEN_SECRET_REQUIRED") return problem(503, "quotes_not_configured", "Secure quote links are not configured.");
    throw error;
  }
}
