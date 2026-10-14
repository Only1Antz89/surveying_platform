import { z } from "zod";
import { problem } from "@/lib/api";
import { pdfResponse } from "@/lib/branded-pdf";
import { publicQuotePdf } from "@/lib/practice-documents";
export const runtime = "nodejs";

/** The client's copy of their quote, through the secure case link. */
export async function GET(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]/pdf">) {
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success || !process.env.DATABASE_ADMIN_URL) return problem(404, "quote_not_found", "The quote could not be found.");
  const document = await publicQuotePdf(id, request.headers.get("x-quote-token") ?? "");
  return document ? pdfResponse(document.bytes, document.filename) : problem(404, "quote_not_found", "The quote link is invalid or has been revoked.");
}
