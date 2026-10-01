import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { searchAddresses } from "@/lib/property-intelligence";

const querySchema = z.string().trim().min(3).max(200);

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const parsed = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!parsed.success) return problem(400, "invalid_query", "Enter between 3 and 200 characters.");
  try {
    const candidates = await searchAddresses(parsed.data, context.organisationId);
    return ok(candidates, { explicitSubmitOnly: true, completeCoverage: false });
  } catch {
    return problem(503, "address_provider_unavailable", "Address search is temporarily unavailable. You can still enter the property manually.");
  }
}
