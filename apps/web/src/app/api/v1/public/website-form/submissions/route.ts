import { formSubmissionSchema } from "@/lib/website-form-config";
import { submitWebsiteForm } from "@/lib/website-form";
import { formFailure, formJson } from "@/lib/website-form-api";
import { ok, problem } from "@/lib/api";
export async function POST(request: Request) {
  try { const parsed = formSubmissionSchema.safeParse(await formJson(request)); if (!parsed.success) return problem(400, "invalid_submission", "Check the required form details.", parsed.error.flatten()); return ok(await submitWebsiteForm(request, parsed.data)); } catch (error) { return formFailure(error); }
}
