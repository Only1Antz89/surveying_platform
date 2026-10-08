import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { auditEvents, createDatabase, organisationOperationalSettings, organisations, serviceDefinitions, servicePricingVersions, withTenant } from "../src/index";

const services = [
  ["RICS Level 1 Survey", 35_000, 120], ["RICS Level 2 Survey", 45_000, 180], ["RICS Level 2 Survey Only", 40_000, 180],
  ["RICS Level 3 Survey", 75_000, 240], ["Drone Survey", 25_000, 90], ["Valuation Report", 30_000, 120],
] as const;

async function main() {
  const { values } = parseArgs({ options: { slug: { type: "string", default: "clifton-surveyors" } } });
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [organisation] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.slug, values.slug!)).limit(1);
  if (!organisation) throw new Error(`Organisation ${values.slug} was not found.`);
  const result = await withTenant(db, organisation.id, async (tx) => {
    await tx.insert(organisationOperationalSettings).values({ organisationId: organisation.id, timezone: "Europe/London", workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"], workingHours: { monday: { start: "09:00", end: "17:30" }, tuesday: { start: "09:00", end: "17:30" }, wednesday: { start: "09:00", end: "17:30" }, thursday: { start: "09:00", end: "17:30" }, friday: { start: "09:00", end: "17:30" } }, bookingHorizonDays: 90, mileageRatePence: 45, documentRetentionDays: 2555, publicQuotesEnabled: false, clientPaymentsEnabled: false }).onConflictDoNothing();
    let created = 0;
    for (const [name, baseAmountMinor, durationMinutes] of services) {
      let [service] = await tx.select().from(serviceDefinitions).where(and(eq(serviceDefinitions.organisationId, organisation.id), eq(serviceDefinitions.name, name))).limit(1);
      if (!service) [service] = await tx.insert(serviceDefinitions).values({ organisationId: organisation.id, name, defaultFee: (baseAmountMinor / 100).toFixed(2) }).returning();
      const [pricing] = await tx.select({ id: servicePricingVersions.id }).from(servicePricingVersions).where(and(eq(servicePricingVersions.serviceDefinitionId, service.id), eq(servicePricingVersions.version, 1))).limit(1);
      if (!pricing) {
        await tx.insert(servicePricingVersions).values({ organisationId: organisation.id, serviceDefinitionId: service.id, version: 1, baseAmountMinor, vatBasisPoints: 2000, depositBasisPoints: 1000, durationMinutes, validityDays: 7, surcharges: { "loft-conversion": { label: "Loft conversion", amountMinor: 8000 }, "single-storey-extension": { label: "Single-storey extension", amountMinor: 8000 }, "double-storey-extension": { label: "Double-storey extension", amountMinor: 8000 }, conservatory: { label: "Conservatory", amountMinor: 8000 } }, recommendationRules: { source: "clifton_adviser_v1" } });
        created += 1;
      }
    }
    await tx.insert(auditEvents).values({ organisationId: organisation.id, action: "operations.clifton_defaults_seeded", resourceType: "organisation", resourceId: organisation.id, metadata: { created } });
    return created;
  });
  console.log(`Created ${result} Clifton pricing versions. Public quotes and client payments remain disabled.`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
