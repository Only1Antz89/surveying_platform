import { and, desc, eq } from "drizzle-orm";
import { createDatabase, serviceDefinitions, servicePricingVersions, withTenant } from "@surveynt/db";
import { resolvePublicOrganisation } from "@/lib/firm-operations";
import { ok, problem } from "@/lib/api";

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("organisationSlug") ?? undefined;
  const organisation = await resolvePublicOrganisation(request, slug);
  if (!organisation) return problem(404, "organisation_not_found", "The quoting practice could not be found.");
  const rows = await withTenant(createDatabase(), organisation.id, (tx) => tx.select({ id: serviceDefinitions.id, name: serviceDefinitions.name, pricing: servicePricingVersions }).from(serviceDefinitions).innerJoin(servicePricingVersions, and(eq(servicePricingVersions.serviceDefinitionId, serviceDefinitions.id), eq(servicePricingVersions.active, true))).where(and(eq(serviceDefinitions.organisationId, organisation.id), eq(serviceDefinitions.active, true))).orderBy(serviceDefinitions.name, desc(servicePricingVersions.version)));
  const latest = [...new Map(rows.map((row) => [row.id, row])).values()];
  const unique = latest.map((row) => ({ id: row.id, name: row.name, currency: row.pricing.currency, baseAmountMinor: row.pricing.baseAmountMinor, vatBasisPoints: row.pricing.vatBasisPoints, depositBasisPoints: row.pricing.depositBasisPoints, surcharges: row.pricing.surcharges, validityDays: row.pricing.validityDays }));
  return ok({ organisation: { slug: organisation.slug, name: organisation.name }, adviserEnabled: latest.some((row) => row.pricing.recommendationRules.source === "clifton_adviser_v1"), services: unique });
}
