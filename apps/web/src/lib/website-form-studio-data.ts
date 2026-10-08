import "server-only";
import { createDatabase, organisations, organisationOperationalSettings, withTenant } from "@surveynt/db";
import { eq } from "drizzle-orm";
import { defaultWebsiteForm, type FormContext } from "./website-form-config";
import { formCatalogue, readFormStudio } from "./website-form";
export async function studioData(access: { userId: string; organisationId: string; organisationName: string }, slug: string) {
  if (access.userId === "demo_user") return { config: defaultWebsiteForm(access.organisationName), revision: 0, activeVersionId: null, versions: [], services: [{ id: "00000000-0000-4000-8000-000000000001", name: "RICS Level 2 Survey Only", description: "Fictional example scope for an interactive preview, not a published service.", currency: "GBP", baseAmountMinor: 45000, vatBasisPoints: 2000, depositBasisPoints: 1000, surcharges: {}, validityDays: 7, adviser: true }], quotesReady: true, demo: true, slug, versionId: null, previewOnly: true };
  const [studio, services, readiness] = await Promise.all([readFormStudio(access.organisationId, access.organisationName), withTenant(createDatabase(), access.organisationId, tx => formCatalogue(tx, access.organisationId)), withTenant(createDatabase(), access.organisationId, async tx => { const [settings] = await tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, access.organisationId)).limit(1); const [org] = await tx.select().from(organisations).where(eq(organisations.id, access.organisationId)).limit(1); return { quotesReady: Boolean(settings?.publicQuotesEnabled && (org?.isDemo || process.env.QUOTE_TOKEN_SECRET)), demo: org?.isDemo ?? false }; })]);
  return { ...studio, services, ...readiness, slug, versionId: studio.activeVersionId, previewOnly: false };
}
export type StudioData = Awaited<ReturnType<typeof studioData>>;
export const studioContext = (data: StudioData): FormContext => ({ config: data.config, services: data.services, quotesReady: data.quotesReady, demo: data.demo, slug: data.slug, versionId: data.versionId });
