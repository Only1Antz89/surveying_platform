import { problem } from "./api";
import { PortalError, type PortalCredential } from "./client-portal";

/** Reads the portal credential: the link token travels in a header, never in a URL that could be logged. */
export function portalCredential(request: Request, id: string): PortalCredential {
  const via = new URL(request.url).searchParams.get("via") === "quote" ? "quote" : "portal";
  return { via, id, token: request.headers.get("x-portal-token") ?? "" };
}
export function portalFailure(error: unknown) {
  if (error instanceof PortalError) return problem(error.status, error.code, error.message);
  throw error;
}
export const fileHeaders = (contentType: string, filename: string, inline: boolean) => ({ "content-type": contentType, "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/[^\w.-]/g, "-")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
