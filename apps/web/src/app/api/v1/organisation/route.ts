import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  return ok({ id: context.organisationId, name: "North Star Surveying", slug: "north-star-surveying", status: "active", branding: { accentColour: "#2563eb" } }, { demo: context.demo });
}
