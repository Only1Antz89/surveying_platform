import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { EngagementError, practiceTerms, publishTerms, saveTermsDraft, setTermsRequired, termsDraftInput } from "@/lib/engagement-terms";
import { demoTerms } from "@/lib/demo-engagement";

const managers = new Set(["owner", "administrator", "manager"]);
const action = z.discriminatedUnion("action", [z.object({ action: z.literal("publish"), termsId: z.uuid() }), z.object({ action: z.literal("require"), required: z.boolean() })]);
const failure = (error: unknown) => { if (error instanceof EngagementError) return problem(error.status, error.code, error.message); throw error; };

async function guarded(request: Request, write: boolean) {
  const context = await apiContext(request);
  if (!context) return { response: problem(401, "unauthorised", "Sign in required.") };
  const denial = await workspaceApiGuard(request, context);
  if (denial) return { response: denial };
  if (!managers.has(context.role)) return { response: problem(403, "forbidden", "Practice management access is required.") };
  if (write && context.accessLevel !== "full") return { response: problem(403, "read_only", "Changing terms requires an active workspace.") };
  return { context };
}

/** The practice's terms of engagement, every version and whether a signature is required. */
export async function GET(request: Request) {
  const { context, response } = await guarded(request, false);
  if (!context) return response;
  return ok(context.demo ? demoTerms : await practiceTerms(context), context.demo ? { demo: true } : {});
}

/** Saves the single working draft (creating the next version number when none exists). */
export async function POST(request: Request) {
  const { context, response } = await guarded(request, true);
  if (!context) return response;
  const parsed = await parseBody(request, termsDraftInput);
  if (!parsed.success) return problem(422, "invalid_terms", "Give the terms a title and at least a short paragraph of wording.");
  if (context.demo) return ok({ ...demoTerms.versions[0], id: "demo-draft", version: demoTerms.versions[0].version + 1, status: "draft", publishedAt: null, ...parsed.data }, { demo: true, persisted: false });
  try { return ok(await saveTermsDraft(context, parsed.data)); } catch (error) { return failure(error); }
}

/** Publishes the draft (retiring the previous version) or changes the signature requirement. */
export async function PATCH(request: Request) {
  const { context, response } = await guarded(request, true);
  if (!context) return response;
  const parsed = await parseBody(request, action);
  if (!parsed.success) return problem(422, "invalid_action", "Choose a valid change.");
  if (context.demo) return ok(parsed.data, { demo: true, persisted: false });
  try { return ok(parsed.data.action === "publish" ? await publishTerms(context, parsed.data.termsId) : await setTermsRequired(context, parsed.data.required)); } catch (error) { return failure(error); }
}
