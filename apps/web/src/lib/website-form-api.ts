import { WebsiteFormError } from "./website-form";
import { problem } from "./api";
export async function formJson(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new WebsiteFormError(400, "invalid_request", "A JSON body is required.");
  let bytes = 0; const chunks: Uint8Array[] = [];
  while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 32_768) { await reader.cancel(); throw new WebsiteFormError(413, "request_too_large", "The form submission is too large."); } chunks.push(next.value); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new WebsiteFormError(400, "invalid_json", "The form request is invalid."); }
}
export function formFailure(error: unknown) {
  if (error instanceof WebsiteFormError) return problem(error.status, error.code, error.message);
  const message = error instanceof Error ? error.message : "";
  if (message === "QUOTE_REQUEST_CHANGED") return problem(409, "request_changed", "Your answers changed. Please start a new submission.");
  if (message === "WEBSITE_REQUEST_ALREADY_SUBMITTED") return problem(409, "request_already_submitted", "This request was already received as an enquiry. Please contact the practice rather than submitting it again.");
  if (["QUOTE_TOKEN_SECRET_REQUIRED", "PUBLIC_QUOTES_DISABLED", "SERVICE_UNAVAILABLE"].includes(message)) return problem(409, "quote_unavailable", "Online quoting is unavailable. Please contact the practice.");
  console.error("Website form operation failed", error instanceof Error ? error.name : "Unknown error");
  return problem(503, "form_unavailable", "This service is temporarily unavailable. Please try again or contact the practice.");
}
