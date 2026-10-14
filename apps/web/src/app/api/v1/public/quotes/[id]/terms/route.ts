import { z } from "zod";
import { ok, parseBody, problem } from "@/lib/api";
import { EngagementError, publicEngagement, signatureInput, signPublicEngagement } from "@/lib/engagement-terms";

const token = (request: Request) => request.headers.get("x-quote-token") ?? "";
const clientIp = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;

/** The practice's current terms and the client's signature for this case. */
export async function GET(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]/terms">) {
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "case_not_found", "This case link is unavailable.");
  if (!process.env.DATABASE_ADMIN_URL) return problem(503, "terms_unavailable", "Terms are not available in this preview.");
  const found = await publicEngagement(id, token(request));
  return found ? ok(found) : problem(404, "case_not_found", "This case link is unavailable.");
}

/** Signs the current terms by typed name. The exact wording's SHA-256 is stored with the signature. */
export async function POST(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]/terms">) {
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "case_not_found", "This case link is unavailable.");
  if (!process.env.DATABASE_ADMIN_URL) return problem(503, "terms_unavailable", "Terms are not available in this preview.");
  const parsed = await parseBody(request, signatureInput);
  if (!parsed.success) return problem(422, "invalid_signature", "Type your full name and confirm you agree to the terms.");
  try { return ok(await signPublicEngagement(id, token(request), parsed.data, { ip: clientIp(request), userAgent: request.headers.get("user-agent") })); }
  catch (error) { if (error instanceof EngagementError) return problem(error.status, error.code, error.message); throw error; }
}
