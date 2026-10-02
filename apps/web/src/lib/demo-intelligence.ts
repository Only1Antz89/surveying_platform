import { sourceDefinitions } from "@surveynt/property-data";
import type { PropertyIntelligence } from "./intelligence";

/** Explicitly labelled demo intelligence. Never shown for connected workspaces. */
export function demoIntelligence(): PropertyIntelligence {
  const retrievedAt = new Date().toISOString();
  return {
    enabled: false,
    fingerprint: "demo",
    location: { country: "ENG", confidence: "surveyor_confirmed", uprnConfirmed: true },
    latestRun: { id: "demo-run", status: "completed", createdAt: retrievedAt, completedAt: retrievedAt, error: null, current: true },
    categories: [
      { sourceKey: "planning_data", category: "conservation_area", status: "matched", informationClass: "authoritative_external", coverage: "partial", message: "DEMO DATA: illustrative only.", retrievedAt, expiresAt: retrievedAt, datasetVersion: null, fresh: true, stale: false, licence: { name: "Demo", attribution: "Demo data" }, records: [{ snapshotId: "demo-1", sourceRecordId: "demo", data: { label: "Conservation area", name: "DEMO Clifton conservation area" }, evidence: [], matchMethod: "point_in_polygon", confidence: "medium", sourceUpdatedAt: null }] },
      { sourceKey: "planning_data", category: "article_4_direction", status: "no_match", informationClass: "authoritative_external", coverage: "partial", message: "DEMO DATA: no record found in the queried dataset. Coverage varies by local planning authority.", retrievedAt, expiresAt: retrievedAt, datasetVersion: null, fresh: true, stale: false, licence: { name: "Demo", attribution: "Demo data" }, records: [] },
      { sourceKey: "epc_england_wales", category: "energy_certificate", status: "not_configured", informationClass: "authoritative_external", coverage: "unknown", message: "DEMO: EPC access is not configured.", retrievedAt, expiresAt: null, datasetVersion: null, fresh: false, stale: false, licence: { name: "Demo", attribution: "Demo data" }, records: [] },
    ],
    sources: sourceDefinitions.map((source) => ({ key: source.key, name: source.name, organisation: source.organisation, category: source.category, registerStatus: source.registerStatus, enabled: false, coversProperty: source.coverage.includes("ENG"), coverage: source.coverage, coverageNotes: source.coverageNotes, licence: source.licence, documentationUrl: source.documentationUrl, refreshDays: source.refreshPolicy.days, guardrail: source.guardrail, checkedAt: source.checkedAt })),
  };
}
