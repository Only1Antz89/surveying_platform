import { z } from "zod";
import { canMutateOperations } from "@surveynt/domain";
import { sourceRegistry } from "@surveynt/property-data";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { enqueuePropertyIntelligence, loadPropertyIntelligence } from "@/lib/property-intelligence";

export async function GET(request: Request, route: RouteContext<"/api/v1/properties/[id]/intelligence">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const { id } = await route.params;
  if (context.demo) return ok({ property: { id, country: null, uprn: null, latitude: null, longitude: null, locationConfidence: "unresolved" }, runs: [], snapshots: [], sources: sourceRegistry.map((source) => ({ ...source, limitations: "Development preview. Configure and verify the live source before use.", attribution: source.organisation, enabled: source.key === "planning_data", latestSuccessfulSyncAt: null })) }, { demo: true });
  const data = await loadPropertyIntelligence(context.organisationId, id);
  return data ? ok(data) : problem(404, "property_not_found", "The property could not be found.");
}

const idempotencySchema = z.string().trim().min(8).max(200);

export async function POST(request: Request, route: RouteContext<"/api/v1/properties/[id]/intelligence">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before refreshing property intelligence.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot refresh property intelligence.");
  const { id } = await route.params;
  const parsedKey = idempotencySchema.safeParse(request.headers.get("idempotency-key") ?? "");
  if (!parsedKey.success) return problem(400, "idempotency_key_required", "Provide an Idempotency-Key header between 8 and 200 characters.");
  if (context.demo) return Response.json({ data: { run: { id: crypto.randomUUID(), status: "queued" }, duplicate: false }, meta: { demo: true, persisted: false } }, { status: 202 });
  const result = await enqueuePropertyIntelligence({ organisationId: context.organisationId, propertyId: id, actorUserId: context.internalUserId, idempotencyKey: parsedKey.data });
  if (result.kind === "missing") return problem(404, "property_not_found", "The property could not be found.");
  if (result.kind === "identity_required") return problem(409, "property_identity_required", "Confirm the property location before refreshing intelligence.");
  if (result.kind === "rate_limited") return Response.json({ error: { code: "refresh_rate_limited", message: "Wait before requesting another property intelligence refresh." } }, { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } });
  return Response.json({ data: { run: result.run, duplicate: result.duplicate } }, { status: 202 });
}
