import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { listTemplates, MessageError, saveReviewSettings, saveTemplate } from "@/lib/client-messages";
import { templateInput } from "@/lib/client-messages-model";
import { demoTemplates } from "@/lib/demo-crm";

const managers = new Set(["owner", "administrator", "manager"]);
const failure = (error: unknown) => { if (error instanceof MessageError) return problem(error.status, error.code, error.message); throw error; };
async function guarded(request: Request, write: boolean) {
  const context = await apiContext(request);
  if (!context) return { response: problem(401, "unauthorised", "Sign in required.") };
  const denial = await workspaceApiGuard(request, context);
  if (denial) return { response: denial };
  if (!managers.has(context.role)) return { response: problem(403, "forbidden", "Practice management access is required.") };
  if (write && context.accessLevel !== "full") return { response: problem(403, "read_only", "Changes require an active workspace.") };
  return { context };
}

/** Client message templates (email and text) and review request settings. */
export async function GET(request: Request) {
  const { context, response } = await guarded(request, false);
  if (!context) return response;
  return ok(context.demo ? demoTemplates() : await listTemplates(context), context.demo ? { demo: true } : {});
}
export async function PUT(request: Request) {
  const { context, response } = await guarded(request, true);
  if (!context) return response;
  const parsed = await parseBody(request, templateInput);
  if (!parsed.success) return problem(422, "invalid_template", parsed.error.issues[0]?.message ?? "Check the message wording.");
  if (context.demo) return ok({ ...parsed.data, subject: parsed.data.subject ?? null, customised: true }, { demo: true, persisted: false });
  try { return ok(await saveTemplate(context, parsed.data)); } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  const { context, response } = await guarded(request, true);
  if (!context) return response;
  const parsed = await parseBody(request, z.object({ enabled: z.boolean(), reviewUrl: z.url().refine((value) => value.startsWith("https://"), "Use an https link.").nullable(), delayDays: z.number().int().min(0).max(30) }));
  if (!parsed.success) return problem(422, "invalid_settings", "Use an https review link and a delay of 0 to 30 days.");
  if (context.demo) return ok(parsed.data, { demo: true, persisted: false });
  try { return ok(await saveReviewSettings(context, parsed.data)); } catch (error) { return failure(error); }
}
