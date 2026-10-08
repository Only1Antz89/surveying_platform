import { z } from "zod";
import { acceptQuoteAddress, readPublicQuote } from "@/lib/firm-operations";
import { ok, parseBody, problem } from "@/lib/api";

const token = (request: Request) => request.headers.get("x-quote-token") ?? "";
const addressSchema = z.object({ line1: z.string().trim().min(3).max(300), city: z.string().trim().min(2).max(120), postcode: z.string().trim().regex(/^(GIR ?0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/i) });

export async function GET(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]">) {
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success) return problem(404, "quote_not_found", "The quote could not be found.");
  const found = await readPublicQuote(id, token(request));
  return found ? ok(found.view) : problem(404, "quote_not_found", "The quote link is invalid or has been revoked.");
}

export async function PATCH(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]">) {
  const parsed = await parseBody(request, addressSchema);
  if (!parsed.success) return problem(400, "invalid_address", "Enter a complete UK property address.", parsed.error.flatten());
  const { id } = await route.params;
  try {
    const found = await acceptQuoteAddress(id, token(request), parsed.data);
    return found ? ok(found.view) : problem(404, "quote_not_found", "The quote is unavailable or has expired.");
  } catch (error) {
    if ((error as Error).message === "QUOTE_CHANGED") return problem(409, "quote_changed", "The quote changed. Reload it before continuing.");
    throw error;
  }
}
