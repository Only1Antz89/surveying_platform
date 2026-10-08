import type { PreinspectionAnswers } from "@surveynt/assistant";
import type { IntelligenceCategoryView } from "./intelligence";

/** Context only. These strings cannot write a survey answer or condition rating. */
export function questionnaireFieldContext(path: string, answers: PreinspectionAnswers): string[] {
  const keys: Partial<Record<string, (keyof PreinspectionAnswers)[]>> = {
    "a.details.property_status": ["occupancy"], "a.details.access_arrangements": ["access"], "a.details.client_brief": ["concerns"],
    "b.details.documents_requested": ["alterations", "documentsAvailable", "guarantees"],
    "c.details.flat_information": ["floor", "sharedFacilities"], "c.details.accommodation": ["accommodation"],
    "h.details.regulations": ["alterations", "documentsAvailable"], "h.details.guarantees": ["guarantees"], "h.details.other_matters": ["reportedTenure", "boundaries"],
    "g.g1.construction": ["garages"], "g.g2.construction": ["outbuildings"], "g.g3.construction": ["boundaries", "parking"],
  };
  const fields = keys[path] ?? (/^f\.f[1-8]\.construction$/.test(path) ? ["services", "documentsAvailable"] as (keyof PreinspectionAnswers)[] : []);
  return fields.flatMap(key => typeof answers[key] === "string" && answers[key]?.trim() ? [`Customer reports (${key}): ${answers[key]}`] : []);
}
export function externalFieldContext(path: string, categories: IntelligenceCategoryView[]): string[] {
  const current = categories.filter(category => category.fresh && !category.stale);
  if (["d.d2.construction", "e.e1.construction"].includes(path)) return current.filter(category => category.category === "energy_certificate").flatMap(category => category.records.flatMap(record => typeof record.data.roof === "string" ? [`Historical EPC insulation description: ${record.data.roof}. Not proof of roof covering or structural construction.`] : []));
  if (["c.details.energy_issues", "energy.details.further_energy_advice"].includes(path)) return current.filter(category => category.category === "energy_certificate").flatMap(category => category.records.flatMap(record => Array.isArray(record.data.recommendations) ? record.data.recommendations.slice(0, 30).map(item => {
    const recommendation = item as Record<string, unknown>;
    return `Historical EPC recommendation: ${typeof recommendation.description === "string" ? recommendation.description : `code ${recommendation.improvementCode ?? "unavailable"} (description unavailable)`}. Suitability must be assessed during inspection.`;
  }) : []));
  if (/^i\.details\./.test(path) || path === "c.details.other_local_factors") return current.filter(category => ["ea_flood_zones", "ea_rofsw", "bgs_geology_625k", "ne_designations"].includes(category.sourceKey)).map(category => `${category.category.replace(/_/g, " ")}: ${category.status.replace(/_/g, " ")} · ${category.coverage.replace(/_/g, " ")}. ${category.message ?? "Context only; not a property-specific assessment."} Missing records do not establish absence or safety.`);
  return [];
}
