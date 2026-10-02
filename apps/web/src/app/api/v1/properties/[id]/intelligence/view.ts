import { z } from "zod";
import { categoryInfo, type CategoryGroup } from "@surveynt/property-data";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { demoIntelligence } from "@/lib/demo-intelligence";
import { loadPropertyIntelligence } from "@/lib/intelligence";

/** Shared handler for the full and filtered intelligence views (one stored result, several lenses). */
export async function intelligenceResponse(request: Request, id: string, groups?: CategoryGroup[]) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const filter = <T extends { category: string }>(items: T[]) => groups ? items.filter((item) => groups.includes(categoryInfo(item.category).group)) : items;
  if (context.demo) {
    const demo = demoIntelligence();
    return ok({ ...demo, categories: filter(demo.categories) }, { demo: true });
  }
  if (!z.uuid().safeParse(id).success) return problem(404, "property_not_found", "The property could not be found.");
  const data = await loadPropertyIntelligence(context, id);
  if (!data) return problem(404, "property_not_found", "The property could not be found.");
  return ok({ ...data, categories: filter(data.categories) });
}
