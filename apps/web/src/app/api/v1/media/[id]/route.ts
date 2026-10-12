import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { apiContext } from "@/lib/access";
import { problem } from "@/lib/api";
import { readSurveyMedia } from "@/lib/surveys";
import { mediaByteRange, rangedMediaStream } from "@/lib/media-range";

export const runtime = "nodejs";

/** Streams a private original to an authorised member of the owning firm. Never cached by shared caches. */
export async function GET(request: Request, route: RouteContext<"/api/v1/media/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const { id } = await route.params;
  if (context.demo || !z.uuid().safeParse(id).success) return problem(404, "media_not_found", "The file could not be found.");
  const result = await readSurveyMedia(context, id);
  if (!result) return problem(404, "media_not_found", "The file could not be found.");
  if ("removed" in result) return problem(410, "original_removed", "This original was removed after its retention review.");
  if (result.media.kind === "video") {
    const size = result.media.byteSize;
    const headers = { "content-type": result.media.contentType, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "accept-ranges": "bytes", "content-disposition": "inline" };
    const requested = request.headers.get("range");
    if (requested) {
      const range = mediaByteRange(requested, size);
      if (!range) { await result.object.stream.cancel(); return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } }); }
      return new Response(rangedMediaStream(result.object.stream, range.start, range.end), { status: 206, headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${size}`, "content-length": String(range.end-range.start+1) } });
    }
    return new Response(result.object.stream, { headers: { ...headers, "content-length": String(size) } });
  }
  return new Response(result.object.stream, { headers: { "content-type": result.media.contentType, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": result.media.kind === "document" ? "attachment" : "inline" } });
}
