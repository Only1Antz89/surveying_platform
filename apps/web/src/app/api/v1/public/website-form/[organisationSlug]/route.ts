import { publicForm } from "@/lib/website-form";
import { formFailure } from "@/lib/website-form-api";
import { ok, problem } from "@/lib/api";
export async function GET(request: Request, { params }: { params: Promise<{ organisationSlug: string }> }) {
  try { const form = await publicForm(request, (await params).organisationSlug); if (!form) return problem(404, "form_unavailable", "This form is not available."); const response = ok(form); response.headers.set("Cache-Control", "no-store"); return response; } catch (error) { return formFailure(error); }
}
