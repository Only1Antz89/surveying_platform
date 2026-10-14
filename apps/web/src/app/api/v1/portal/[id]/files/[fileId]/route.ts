import { problem } from "@/lib/api";
import { portalFile } from "@/lib/client-portal";
import { fileHeaders, portalCredential, portalFailure } from "@/lib/portal-route";
export const runtime = "nodejs";

/** A photo, video or certificate the practice has shared. Images and PDFs open in the browser; ?download saves. */
export async function GET(request: Request, route: RouteContext<"/api/v1/portal/[id]/files/[fileId]">) {
  const { id, fileId } = await route.params;
  if (id === "demo") return problem(404, "file_not_found", "Demonstration files are illustrations shown in the page.");
  try {
    const file = await portalFile(portalCredential(request, id), fileId);
    const inline = !new URL(request.url).searchParams.has("download") && /^(image\/(jpeg|png|webp)|application\/pdf|video\/(mp4|webm))$/.test(file.contentType);
    return new Response(file.stream, { headers: { ...fileHeaders(file.contentType, file.filename, inline), "content-length": String(file.size) } });
  } catch (error) { return portalFailure(error); }
}
