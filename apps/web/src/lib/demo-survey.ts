import { suggestedServiceScope } from "./service-scope";
import { defaultTemplate, homeSurveyTemplatesV1_1 as homeSurveyTemplates } from "@surveynt/assistant";
import { jobs as demoJobs, properties as demoProperties } from "./demo-data";

/** Labelled demo pack so the capture workflow can be explored without a database. Nothing is persisted. */
export function demoSurveyPack(jobId: string) {
  const job = demoJobs.find((item) => item.id === jobId);
  if (!job) return null;
  const property = demoProperties.find((item) => job.address.includes(item.address));
  const serviceLevel = suggestedServiceScope(job.service) ?? "bespoke";
  const template = homeSurveyTemplates.find(item => item.serviceLevels.includes(serviceLevel)) ?? defaultTemplate;
  return {
    survey: { id: `demo-survey-${job.id}`, jobId: job.id, propertyId: property?.id ?? "demo", status: "in_progress" as const, serviceLevel, jurisdiction: "ENG" as const, templateKey: template.key, templateVersion: template.version, version: 1, createdAt: new Date().toISOString() },
    job: { reference: job.reference, serviceName: job.service },
    property: { line1: property?.address ?? job.address, city: property?.town ?? "", postcode: property?.postcode ?? "" },
    template,
    elements: [],
    values: [],
    observations: [],
    media: [],
    evidence: [],
    assistantEnabled: true,
    proposals: [
      { id: "demo-proposal-1", fieldPath: template.key === defaultTemplate.key ? "about.property.construction_period" : "c.details.built_year", proposedValue: { state: "provided", value: template.key === defaultTemplate.key ? "1900_1929" : "1900–1929" }, originClass: "external_record", evidenceRefs: [{ type: "intelligence_snapshot", id: "demo", label: "DEMO energy certificate lodged 2023-06-12" }], limitations: ["SIMULATED EXAMPLE — not a live record for this property.", "EPC construction band: verify during inspection; not an exact year."], baseValueId: null, createdAt: new Date().toISOString() },
      ...(template.key === defaultTemplate.key ? [] : [{ id: "demo-proposal-2", fieldPath: "c.details.property_type", proposedValue: { state: "provided", value: "Semi-detached house" }, originClass: "external_record", evidenceRefs: [{ type: "intelligence_snapshot", id: "demo-type", label: "DEMO energy certificate" }], limitations: ["SIMULATED EXAMPLE — confirm the current property type yourself."], baseValueId: null, createdAt: new Date().toISOString() }]),
    ],
    tasks: [{ id: "demo-task-1", kind: "reinspect", status: "open", title: "Reinspect: roof coverings (Rear slope)", detail: "DEMO · An earlier survey recorded slipped slates. This is historical context only. Record what you see now.", elementKey: "roof_coverings", fieldPath: null, evidence: {} }],
  };
}
