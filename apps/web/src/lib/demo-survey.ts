import { defaultTemplate } from "@surveynt/assistant";
import { jobs as demoJobs, properties as demoProperties } from "./demo-data";

/** Labelled demo pack so the capture workflow can be explored without a database. Nothing is persisted. */
export function demoSurveyPack(jobId: string) {
  const job = demoJobs.find((item) => item.id === jobId);
  if (!job) return null;
  const property = demoProperties.find((item) => job.address.includes(item.address));
  return {
    survey: { id: `demo-survey-${job.id}`, jobId: job.id, propertyId: property?.id ?? "demo", status: "in_progress" as const, serviceLevel: "level_2" as const, jurisdiction: "ENG" as const, templateKey: defaultTemplate.key, templateVersion: defaultTemplate.version, version: 1, createdAt: new Date().toISOString() },
    job: { reference: job.reference, serviceName: job.service },
    property: { line1: property?.address ?? job.address, city: property?.town ?? "", postcode: property?.postcode ?? "" },
    template: defaultTemplate,
    elements: [],
    values: [],
    observations: [],
    media: [],
    evidence: [],
    tasks: [{ id: "demo-task-1", kind: "reinspect", status: "open", title: "Reinspect: roof coverings (Rear slope)", detail: "DEMO · An earlier survey recorded slipped slates. This is historical context only. Record what you see now.", elementKey: "roof_coverings", fieldPath: null, evidence: {} }],
  };
}
