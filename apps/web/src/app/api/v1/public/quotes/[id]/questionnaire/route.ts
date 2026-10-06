import { ok, problem } from "@/lib/api";
import { PreinspectionError, publicPreinspection, readPreinspection, writePreinspection } from "@/lib/preinspection";
import { QuestionnaireBodyError, readQuestionnaireBody } from "@/lib/questionnaire-body";

async function handle(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]/questionnaire">) {
  const { id } = await route.params;
  try {
    return ok(await publicPreinspection(id, request.headers.get("x-quote-token") ?? "", request.headers.get("x-questionnaire-token") ?? "", async (tx, scope) => request.method === "GET" ? readPreinspection(tx, scope) : writePreinspection(tx, scope, await readQuestionnaireBody(request), request.method === "POST")));
  } catch (error) {
    if (error instanceof PreinspectionError || error instanceof QuestionnaireBodyError) return problem(error.status, error.code, error.message);
    throw error;
  }
}
export const GET = handle;
export const PATCH = handle;
export const POST = handle;
