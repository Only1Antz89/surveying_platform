import { desc, gte, sql } from "drizzle-orm";
import { createDatabase, featureUsageDaily, organisations } from "@surveynt/db";

// In-house feature usage: one daily counter per practice and feature. No user
// identifiers, page contents or third-party trackers are involved.

export const featureLabels: Record<string, string> = { overview: "Overview", jobs: "Jobs", properties: "Properties", reports: "Reports", documents: "Documents", customers: "CRM suite", clients: "Clients", calendar: "Calendar", routes: "Routes", finance: "Finance", performance: "Reports & insights", settings: "Settings", team: "Team", staff: "Staff", fieldwork: "Fieldwork", services: "Services", locations: "Locations", wording: "Wording library", account: "Account" };
export const featureKey = (area: string) => /^[a-z0-9_-]{1,40}$/.test(area) ? area : null;

export async function recordFeatureUse(organisationId: string, area: string, day = new Date()) {
  const feature = featureKey(area);
  if (!feature || !process.env.DATABASE_ADMIN_URL) return;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(day);
  try {
    await createDatabase(process.env.DATABASE_ADMIN_URL).insert(featureUsageDaily).values({ day: date, organisationId, feature, count: 1 })
      .onConflictDoUpdate({ target: [featureUsageDaily.day, featureUsageDaily.organisationId, featureUsageDaily.feature], set: { count: sql`${featureUsageDaily.count} + 1` } });
  } catch {
    // Usage counting is best effort and never affects the page.
  }
}

/** Adoption per feature over a period: how many practices used it and how often. */
export async function featureAdoption(days = 30) {
  if (!process.env.DATABASE_ADMIN_URL) return { days, practices: 0, features: [] as { feature: string; label: string; practices: number; uses: number }[] };
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const since = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() - days * 86_400_000));
  const rows = await db.select({ feature: featureUsageDaily.feature, practices: sql<number>`count(distinct ${featureUsageDaily.organisationId})::int`, uses: sql<number>`sum(${featureUsageDaily.count})::int` }).from(featureUsageDaily).where(gte(featureUsageDaily.day, since)).groupBy(featureUsageDaily.feature).orderBy(desc(sql`count(distinct ${featureUsageDaily.organisationId})`), desc(sql`sum(${featureUsageDaily.count})`));
  const [{ active }] = await db.select({ active: sql<number>`count(*)::int` }).from(organisations).where(sql`${organisations.status} = 'active' and not ${organisations.isDemo}`);
  return { days, practices: active, features: rows.map((row) => ({ ...row, label: featureLabels[row.feature] ?? row.feature })) };
}
