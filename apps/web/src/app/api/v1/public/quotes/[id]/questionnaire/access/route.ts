import { ok, problem } from "@/lib/api";
import { PreinspectionError, issuePreinspectionLink, publicPreinspection } from "@/lib/preinspection";

export async function POST(request: Request, route: RouteContext<"/api/v1/public/quotes/[id]/questionnaire/access">) {
  const { id } = await route.params;
  try {
    return ok(await publicPreinspection(id, request.headers.get("x-quote-token") ?? "", null, (tx, scope) => issuePreinspectionLink(tx, scope, id)));
  } catch (error) {
    if (error instanceof PreinspectionError) return problem(error.status, error.code, error.message);
    throw error;
  }
}
