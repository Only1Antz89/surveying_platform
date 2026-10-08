import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { changeWebsiteForm, readFormStudio, websiteFormEditorRole } from "@/lib/website-form";
import { websiteFormSchema } from "@/lib/website-form-config";
import { formFailure, formJson } from "@/lib/website-form-api";
const schema = z.discriminatedUnion("action", [z.object({ action: z.literal("save"), revision: z.number().int().min(0), config: websiteFormSchema }).strict(), z.object({ action: z.literal("publish"), revision: z.number().int().min(0), config: websiteFormSchema }).strict(), z.object({ action: z.literal("restore"), revision: z.number().int().min(0), versionId: z.uuid() }).strict()]);
export async function GET(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Sign in to manage website forms.");
  if (!websiteFormEditorRole(context.role)) return problem(403, "forbidden", "Owner or administrator access is required.");
  if (context.demo) return problem(409, "preview_only", "Local preview does not have persistent configuration.");
  try { return ok(await readFormStudio(context.organisationId, "Your surveying practice")); } catch (error) { return formFailure(error); }
}
export async function PATCH(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Sign in to manage website forms.");
  if (!websiteFormEditorRole(context.role)) return problem(403, "forbidden", "Owner or administrator access is required.");
  if (!canWriteWorkspace(context)) return problem(403, "read_only", "This workspace is read-only.");
  if (context.demo) return problem(409, "preview_only", "Local preview cannot save or publish forms.");
  const origin = request.headers.get("origin"); if (origin && origin !== new URL(request.url).origin) return problem(403, "invalid_origin", "Use the Surveynt settings page.");
  try { const parsed = schema.safeParse(await formJson(request)); if (!parsed.success) return problem(400, "invalid_configuration", "Check the form configuration.", parsed.error.flatten()); return ok(await changeWebsiteForm(context, parsed.data)); } catch (error) { return formFailure(error); }
}
