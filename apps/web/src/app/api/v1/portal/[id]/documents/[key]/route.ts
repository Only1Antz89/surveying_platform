import { problem } from "@/lib/api";
import { portalDocument } from "@/lib/client-portal";
import { fileHeaders, portalCredential, portalFailure } from "@/lib/portal-route";
export const runtime = "nodejs";

/** Generated documents: quote, signed terms, invoices and the issued reports. */
export async function GET(request: Request, route: RouteContext<"/api/v1/portal/[id]/documents/[key]">) {
  const { id, key } = await route.params;
  if (id === "demo") return problem(409, "preview_only", "Documents are produced for real cases. This demonstration uses fictional records.");
  if (!/^(rics_report|practice_report|signed_terms|quote|invoice:[0-9a-f-]{36})$/i.test(key)) return problem(404, "not_available", "This document is not available.");
  try {
    const document = await portalDocument(portalCredential(request, id), key);
    return new Response(Buffer.from(document.bytes), { headers: fileHeaders("application/pdf", document.filename, false) });
  } catch (error) { return portalFailure(error); }
}
