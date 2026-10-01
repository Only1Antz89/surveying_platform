import { z } from "zod";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { problem } from "@/lib/api";
import { enqueuePropertyIntelligence } from "@/lib/property-intelligence";

const idempotencySchema = z.string().trim().min(8).max(200);

export async function POST(request: Request, route: RouteContext<"/api/v1/properties/[id]/intelligence/refresh">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before refreshing property intelligence.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot refresh property intelligence.");
  const parsedKey = idempotencySchema.safeParse(request.headers.get("idempotency-key") ?? "");
  if (!parsedKey.success) return problem(400, "idempotency_key_required", "Provide an Idempotency-Key header between 8 and 200 characters.");
  const { id } = await route.params;
  if (context.demo) return Response.json({ data: { run: { id: crypto.randomUUID(), status: "queued" }, duplicate: false }, meta: { demo: true, persisted: false } }, { status: 202 });
  const result = await enqueuePropertyIntelligence({ organisationId: context.organisationId, propertyId: id, actorUserId: context.internalUserId, idempotencyKey: parsedKey.data });
  if (result.kind === "missing") return problem(404, "property_not_found", "The property could not be found.");
  if (result.kind === "identity_required") return problem(409, "property_identity_required", "Confirm the property location before refreshing intelligence.");
  if (result.kind === "rate_limited") return Response.json({ error: { code: "refresh_rate_limited", message: "Wait before requesting another property intelligence refresh." } }, { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } });
  return Response.json({ data: { run: result.run, duplicate: result.duplicate } }, { status: 202 });
}
