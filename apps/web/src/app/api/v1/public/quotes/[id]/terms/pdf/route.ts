import { z } from "zod";
import { problem } from "@/lib/api";
import { pdfResponse } from "@/lib/branded-pdf";
import { publicSignedTermsPdf } from "@/lib/practice-documents";
export const runtime = "nodejs";

/** The client's copy of the terms they signed. */
export async function GET(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]/terms/pdf">) {
  const { id } = await route.params;
  if (!z.uuid().safeParse(id).success || !process.env.DATABASE_ADMIN_URL) return problem(404, "case_not_found", "This case link is unavailable.");
  const document = await publicSignedTermsPdf(id, request.headers.get("x-quote-token") ?? "");
  return document ? pdfResponse(document.bytes, document.filename) : problem(404, "not_signed", "No signed terms are available for this case.");
}
