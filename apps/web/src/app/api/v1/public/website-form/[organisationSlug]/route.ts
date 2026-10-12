import { publicForm } from "@/lib/website-form";
import { formFailure } from "@/lib/website-form-api";
import { ok, problem } from "@/lib/api";
export async function GET(request: Request, { params }: { params: Promise<{ organisationSlug: string }> }) {
  // Without a database there is no published form; say so rather than implying the practice removed it.
  if (!process.env.DATABASE_APP_URL && !process.env.DATABASE_URL) return problem(503, "form_preview_only", "The public enquiry form is not live in this local preview. Practice owners and administrators can try it from Settings → Website form → Preview.");
  try { const form = await publicForm(request, (await params).organisationSlug); if (!form) return problem(404, "form_unavailable", "This form is not available."); const response = ok(form); response.headers.set("Cache-Control", "no-store"); return response; } catch (error) { return formFailure(error); }
}
