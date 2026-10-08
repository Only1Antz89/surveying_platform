import { canonicalJson, resolveField, validateFieldValue } from "../forms/validate";
import type { FieldValue, FormTemplate } from "../forms/types";
import type { DiscrepancyDraft, EvidenceRef, ProposalDraft } from "./types";
import type { PreinspectionAnswers } from "../questionnaire";

// Deterministic, source-grounded proposals. No model is involved: every
// proposed value is copied or mapped from a cited record, and fields only
// accept proposals from the sources their template definition allows.

export const SOURCED_GENERATOR = "sourced-records-v1";

export type SnapshotEvidence = {
  snapshotId: string;
  sourceKey: string;
  category: string;
  status: string;
  sourceRecordId: string | null;
  data: Record<string, unknown>;
  retrievedAt: string;
  sourceUpdatedAt: string | null;
  coverage?: string;
  confidence?: string;
  matchMethod?: string;
};

export type CurrentValue = { id: string; value: FieldValue };

export type SourcedInput = {
  template: FormTemplate;
  snapshots: SnapshotEvidence[];
  currentValues: Map<string, CurrentValue>;
  job: { id: string; reference: string; targetDate: string | null };
  weather?: { contextId: string; inspectionDate: string; summary: string; retrievedAt: string; attribution: string; url: string };
  questionnaire?: { id: string; version: number; submittedAt: string; answers: PreinspectionAnswers; propertyFingerprint?: string };
  documents?: { id: string; name: string; context: string; worksKind: "extension" | "conversion"; completionDate: string; page: number; excerpt: string }[];
  identity?: { practitioner?: { id: string; name: string | null; ricsNumber: string | null; fingerprint: string }; firm?: { id: string; companyName?: string; address?: string; email?: string; phone?: string; fingerprint: string } };
};

async function sha(value: unknown) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

type Candidate = { fieldPath: string; value: FieldValue; evidence: EvidenceRef[]; sourceKeys: string[]; origin: ProposalDraft["originClass"]; limitations: string[] };

const heritageListed = [
  { sourceKey: "historic_england_nhle", category: "listed_building_nhle", label: "National Heritage List" },
  { sourceKey: "planning_data", category: "listed_building", label: "Planning Data listed building outline" },
  { sourceKey: "cadw_listed_buildings", category: "listed_building_cadw", label: "Cadw" },
  { sourceKey: "hes_designations", category: "listed_building_hes", label: "Historic Environment Scotland" },
  { sourceKey: "ni_hed_listed_buildings", category: "listed_building_ni", label: "Historic Environment Division (NI)" },
];

const conservationSources = [
  { sourceKey: "planning_data", category: "conservation_area", label: "Planning Data" },
  { sourceKey: "hes_designations", category: "conservation_area_hes", label: "Historic Environment Scotland" },
];

function snapshotRef(snapshot: SnapshotEvidence, label: string): EvidenceRef {
  return { type: "intelligence_snapshot", id: snapshot.snapshotId, label, date: snapshot.sourceUpdatedAt ?? snapshot.retrievedAt };
}

function candidates(input: SourcedInput): { candidates: Candidate[]; conflicts: DiscrepancyDraft[] } {
  const found: Candidate[] = [];
  const conflicts: DiscrepancyDraft[] = [];
  if (input.template.version === "1.2.0") for (const document of input.documents ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(document.completionDate)) continue;
    found.push({ fieldPath: `c.details.${document.worksKind === "extension" ? "extended_year" : "converted_year"}`, value: { state: "provided", value: `Document states: ${document.completionDate.slice(0, 4)}` }, sourceKeys: ["confirmed_completion_document"], origin: "document_extraction", evidence: [{ type: "document_span", id: document.id, context: document.context, date: document.completionDate, label: `${document.name}, page ${document.page}: ${document.excerpt}` }], limitations: ["Explicit works-completion date from an uploaded document with surveyor-confirmed property/works association. Check the original and date before applying; not proof of legal compliance or present condition."] });
  }
  if (input.template.version === "1.2.0" && input.identity) {
    const add = (path: string, value: unknown, type: "practitioner_profile" | "firm_report_identity", id: string, context: string) => {
      if (typeof value !== "string" || !value.trim()) return;
      found.push({ fieldPath: path, value: { state: "provided", value }, sourceKeys: [type], origin: "practice_record", evidence: [{ type, id, context, label: type === "practitioner_profile" ? "Recording practitioner's personal report identity" : "Approved firm report identity" }], limitations: ["Review the reusable identity before applying. RICS membership numbers are self-declared, not independently verified. Qualifications, signature and declaration remain manual."] });
    };
    const { practitioner, firm } = input.identity;
    for (const section of ["a", "declaration"]) {
      if (practitioner) { add(`${section}.details.surveyor_name`, practitioner.name, "practitioner_profile", practitioner.id, practitioner.fingerprint); add(`${section}.details.rics_number`, practitioner.ricsNumber, "practitioner_profile", practitioner.id, practitioner.fingerprint); }
      if (firm) add(`${section}.details.company_name`, firm.companyName, "firm_report_identity", firm.id, firm.fingerprint);
    }
    if (firm) { add("declaration.details.company_address", firm.address, "firm_report_identity", firm.id, firm.fingerprint); add("declaration.details.contact_details", [firm.email, firm.phone].filter(Boolean).join(" · "), "firm_report_identity", firm.id, firm.fingerprint); }
  }
  if (input.questionnaire && input.template.version === "1.2.0") {
    const submission = input.questionnaire;
    const evidence: EvidenceRef[] = [{ type: "customer_submission", id: submission.id, label: `Customer questionnaire version ${submission.version} — unverified statement`, date: submission.submittedAt, ...(submission.propertyFingerprint ? { context: submission.propertyFingerprint } : {}) }];
    const add = (fieldPath: string, value: unknown) => {
      if (typeof value === "string" && value.trim()) found.push({ fieldPath, value: { state: "provided", value: `Client reports: ${value.trim()}` }, evidence, sourceKeys: ["customer_questionnaire"], origin: "customer_statement", limitations: ["Customer statement, not an inspection observation. Verify before using in the report.", "Reported dates do not prove completion, legal compliance, ownership or safety."] });
    };
    add("a.details.access_arrangements", submission.answers.access);
    add("a.details.client_brief", submission.answers.concerns);
    add("c.details.property_type", submission.answers.propertyType);
    add("c.details.accommodation", submission.answers.accommodation);
    add("c.details.flat_information", [submission.answers.floor ? `Floor: ${submission.answers.floor}` : null, submission.answers.sharedFacilities].filter(Boolean).join("; "));
    add("c.details.grounds", [submission.answers.garages, submission.answers.outbuildings, submission.answers.parking, submission.answers.boundaries].filter(Boolean).join("; "));
    for (const [field, value] of [["built_year", submission.answers.approximateBuildYear], ["extended_year", submission.answers.extensionCompletionYear], ["converted_year", submission.answers.conversionCompletionYear]] as const) if (value !== undefined) add(`c.details.${field}`, String(value));
    add("valuation.details.tenure", submission.answers.reportedTenure);
    if (submission.answers.agreedPurchasePriceMinor !== undefined) add("valuation.details.agreed_price", `GBP ${(submission.answers.agreedPurchasePriceMinor / 100).toFixed(2)} agreed purchase price; not a professional market valuation`);
  }
  const latestEpc = input.snapshots.find((snapshot) => snapshot.category === "energy_certificate" && snapshot.status === "matched" && snapshot.data.latest === true);
  if (latestEpc) {
    const lodged = typeof latestEpc.data.lodgementDate === "string" ? latestEpc.data.lodgementDate : null;
    const evidence = [snapshotRef(latestEpc, `Energy certificate${lodged ? ` lodged ${lodged}` : ""}`)];
    const limitations = ["EPC record: verify during inspection.", lodged ? `Lodged ${lodged}; later alterations may not be reflected.` : "Lodgement date not recorded."];
    const epcField = (fieldPath: string, value: unknown) => {
      if (typeof value === "string" && value) found.push({ fieldPath, value: { state: "provided", value }, evidence, sourceKeys: [latestEpc.sourceKey], origin: "external_record", limitations });
    };
    epcField("about.property.property_type", latestEpc.data.propertyTypeKey);
    epcField("about.property.built_form", latestEpc.data.builtFormKey);
    epcField("about.property.construction_period", latestEpc.data.constructionPeriodKey);
    epcField("about.property.energy_rating", latestEpc.data.currentRating);
    epcField("c.details.property_type", [latestEpc.data.builtForm, latestEpc.data.propertyType].filter(value => typeof value === "string" && value.trim()).join(" ") || null);
    epcField("c.details.built_year", latestEpc.data.constructionAgeBand);
    const historical = (fieldPath: string, value: unknown) => {
      if (typeof value === "string" && value.trim()) epcField(fieldPath, `Historical EPC description: ${value}. Verify during inspection.`);
    };
    epcField("c.details.energy_rating", latestEpc.data.currentRating);
    historical("c.details.construction", [latestEpc.data.walls, latestEpc.data.floor].filter(value => typeof value === "string" && value.trim()).join("; "));
    historical("c.details.central_heating", latestEpc.data.heating);
    historical("d.d4.construction", latestEpc.data.walls);
    historical("d.d5.construction", latestEpc.data.windows);
    historical("e.e4.construction", latestEpc.data.floor);
    historical("f.f4.construction", latestEpc.data.heating);
    historical("f.f5.construction", latestEpc.data.hotWater);
    historical("energy.details.insulation", [latestEpc.data.roof, latestEpc.data.walls, latestEpc.data.floor].filter(value => typeof value === "string" && value.trim()).join("; "));
    historical("energy.details.heating_energy", [latestEpc.data.heating, latestEpc.data.hotWater].filter(value => typeof value === "string" && value.trim()).join("; "));
    historical("energy.details.energy_efficiency", [typeof latestEpc.data.currentRating === "string" ? `Current band ${latestEpc.data.currentRating}` : null, typeof latestEpc.data.potentialRating === "string" ? `Potential band ${latestEpc.data.potentialRating}` : null].filter(Boolean).join("; "));
    const area = latestEpc.data.totalFloorAreaM2;
    if (typeof area === "number" && Number.isFinite(area) && area > 0) epcField("c.details.accommodation", `Certificate-reported total floor area: ${area} m². Not a surveyed measurement or room layout; confirm accommodation during inspection.`);
  }

  const environmentCategories = ["conservation_area", "listed_building_nhle", "listed_building", "scheduled_monument", "scheduled_monument_nhle", "registered_park_garden", "registered_park_garden_nhle", "registered_battlefield_nhle", "world_heritage_site", "world_heritage_site_nhle", "article_4_direction", "tree_preservation", "green_belt", "sssi", "ancient_woodland", "national_park", "national_landscape", "planning_flood_zone_2", "planning_flood_zone_3"];
  const environment = input.snapshots.filter(snapshot => ["planning_data", "historic_england_nhle", "ea_flood_zones", "ne_designations"].includes(snapshot.sourceKey) && snapshot.status === "matched" && snapshot.data.ended !== true && environmentCategories.includes(snapshot.category)).slice(0, 20);
  if (environment.length) found.push({
    fieldPath: "c.details.local_environment", origin: "external_record", sourceKeys: environment.map(snapshot => snapshot.sourceKey),
    value: { state: "provided", value: `External designation context at the recorded location: ${environment.map(snapshot => `${snapshot.category.replace(/_/g, " ")}${typeof snapshot.data.name === "string" ? ` — ${snapshot.data.name}` : ""}`).join("; ")}. Indicative context only; confirm boundaries and add inspection observations. Flood zones are planning layers, not a property-specific flood-risk assessment.` },
    evidence: environment.map(snapshot => snapshotRef(snapshot, `${snapshot.sourceKey}: ${snapshot.category.replace(/_/g, " ")}`)),
    limitations: ["This is not a complete description of the local environment, noise, traffic, ground conditions or safety.", "Absence of other records is not proof of absence. Coverage varies; confirm with the responsible authority.", ...environment.map(snapshot => `${snapshot.category}: coverage ${snapshot.coverage ?? "unknown"}; matching ${snapshot.matchMethod ?? "unknown"}; confidence ${snapshot.confidence ?? "unknown"}.`)],
  });
  const actualDate = input.currentValues.get("a.details.inspection_date")?.value;
  const geography = input.snapshots.find(snapshot => snapshot.sourceKey === "postcodes_io" && snapshot.category === "postcode_geography" && snapshot.status === "matched");
  if (geography) {
    const description = [["Local authority", geography.data.adminDistrict], ["Region", geography.data.region], ["Ward", geography.data.adminWard]].filter(([, value]) => typeof value === "string" && value.trim()).map(([label, value]) => `${label}: ${value}`).join("; ");
    if (description) found.push({ fieldPath: "c.details.location", value: { state: "provided", value: `Approximate postcode administrative geography: ${description}. Not a property-specific classification; confirm locally.` }, evidence: [snapshotRef(geography, "Postcodes.io postcode geography — approximate")], sourceKeys: ["postcodes_io"], origin: "external_record", limitations: ["Postcode classifications and boundaries do not establish the individual property's location, character or facilities.", "Source update date may be unavailable; retain the retrieval date and attribution."] });
  }
  if (input.weather && actualDate?.state === "provided" && actualDate.value === input.weather.inspectionDate) found.push({
    fieldPath: "a.details.weather", sourceKeys: ["inspection_weather"], origin: "external_record",
    value: { state: "provided", value: input.weather.summary },
    evidence: [{ type: "weather_record", id: input.weather.contextId, label: `${input.weather.attribution}; retrieved ${input.weather.retrievedAt}`, date: input.weather.inspectionDate, url: input.weather.url }],
    limitations: ["Day-wide modelled historical weather, not observed conditions at the inspection time or property. Confirm the actual conditions yourself.", "Gridded estimates can differ from local conditions. Manual entry remains available."],
  });

  const listedMatches = heritageListed.flatMap((source) => input.snapshots.filter((snapshot) => snapshot.sourceKey === source.sourceKey && snapshot.category === source.category && snapshot.status === "matched").map((snapshot) => ({ source, snapshot })));
  const listedChecked = heritageListed.flatMap((source) => input.snapshots.filter((snapshot) => snapshot.sourceKey === source.sourceKey && snapshot.category === source.category && snapshot.status === "no_match").map((snapshot) => ({ source, snapshot })));
  if (listedMatches.length) {
    const evidence = listedMatches.map(({ source, snapshot }) => snapshotRef(snapshot, `${source.label}: ${String(snapshot.data.name ?? snapshot.sourceRecordId ?? "record")}`));
    found.push({ fieldPath: "about.property.listed_status", value: { state: "provided", value: "listed" }, evidence, sourceKeys: listedMatches.map(({ source }) => source.sourceKey), origin: "external_record", limitations: ["The list entry is the legal description; outlines are indicative.", ...listedChecked.map(({ source }) => `${source.label} has no matching record; its coverage may be partial.`)] });
    const grades = [...new Set(listedMatches.map(({ snapshot }) => (snapshot.data.attributes as Record<string, unknown> | undefined)?.Grade).filter((grade): grade is string => typeof grade === "string" && grade.length > 0))];
    if (grades.length === 1) found.push({ fieldPath: "about.property.listing_grade", value: { state: "provided", value: grades[0] }, evidence, sourceKeys: listedMatches.map(({ source }) => source.sourceKey), origin: "external_record", limitations: ["Confirm the grade on the official list entry."] });
    if (grades.length > 1) conflicts.push({ kind: "discrepancy", dedupeKey: `discrepancy:listing_grade:${grades.sort().join("|")}`, fieldPath: "about.property.listing_grade", title: "Sources disagree on the listing grade", detail: `Recorded grades differ (${grades.join(", ")}). Check the official list entry before recording a grade.`, evidence: { snapshots: listedMatches.map(({ snapshot }) => snapshot.snapshotId) } });
  } else if (listedChecked.length) {
    found.push({ fieldPath: "about.property.listed_status", value: { state: "provided", value: "no_record_found" }, evidence: listedChecked.map(({ source, snapshot }) => snapshotRef(snapshot, `${source.label}: no matching record`)), sourceKeys: listedChecked.map(({ source }) => source.sourceKey), origin: "external_record", limitations: ["No record was found in the checked sources. This is not proof that the building is unlisted."] });
  }

  const conservationMatches = conservationSources.flatMap((source) => input.snapshots.filter((snapshot) => snapshot.sourceKey === source.sourceKey && snapshot.category === source.category && snapshot.status === "matched").map((snapshot) => ({ source, snapshot })));
  const conservationChecked = conservationSources.flatMap((source) => input.snapshots.filter((snapshot) => snapshot.sourceKey === source.sourceKey && snapshot.category === source.category && snapshot.status === "no_match").map((snapshot) => ({ source, snapshot })));
  if (conservationMatches.length) found.push({ fieldPath: "about.property.conservation_area", value: { state: "provided", value: "in_area" }, evidence: conservationMatches.map(({ source, snapshot }) => snapshotRef(snapshot, `${source.label}: ${String(snapshot.data.name ?? "conservation area")}`)), sourceKeys: conservationMatches.map(({ source }) => source.sourceKey), origin: "external_record", limitations: ["Confirm with the local planning authority; boundaries and records can lag."] });
  else if (conservationChecked.length) found.push({ fieldPath: "about.property.conservation_area", value: { state: "provided", value: "no_record_found" }, evidence: conservationChecked.map(({ source, snapshot }) => snapshotRef(snapshot, `${source.label}: no matching record`)), sourceKeys: conservationChecked.map(({ source }) => source.sourceKey), origin: "external_record", limitations: ["Coverage varies by local planning authority. This is not proof that the property is outside a conservation area."] });

  if (input.job.targetDate) found.push({ fieldPath: "inspection.visit.inspection_date", value: { state: "provided", value: input.job.targetDate }, evidence: [{ type: "job", id: input.job.id, label: `Job ${input.job.reference} target date`, date: input.job.targetDate }], sourceKeys: ["job_record"], origin: "job_record", limitations: ["Scheduled date from the job record. Confirm the date the inspection actually took place."] });
  return { candidates: found, conflicts };
}

/**
 * Builds proposals and discrepancy tasks. A value that conflicts with what the
 * surveyor already recorded becomes a discrepancy task, never a silent replacement.
 */
export async function generateSourcedProposals(input: SourcedInput): Promise<{ proposals: ProposalDraft[]; discrepancies: DiscrepancyDraft[] }> {
  const { candidates: found, conflicts } = candidates(input);
  const proposals: ProposalDraft[] = [];
  const discrepancies = [...conflicts];
  for (const candidate of found) {
    const resolved = resolveField(input.template, candidate.fieldPath);
    if (!resolved) continue;
    const allowed = candidate.origin === "job_record" ? resolved.field.fieldClass === "clerical" : candidate.sourceKeys.every((key) => resolved.field.proposalSources?.includes(key));
    if (!allowed) continue;
    const validation = validateFieldValue(resolved.field, candidate.value);
    if (!validation.ok) continue;
    const current = input.currentValues.get(candidate.fieldPath);
    if (current?.value.state === "provided") {
      if (canonicalJson(current.value) === canonicalJson(validation.value)) continue;
      discrepancies.push({
        kind: "discrepancy",
        dedupeKey: `discrepancy:${candidate.fieldPath}:${await sha({ current: current.id, proposed: validation.value })}`,
        fieldPath: candidate.fieldPath,
        title: `Recorded ${resolved.field.label.toLowerCase()} differs from a source`,
        detail: `You recorded "${String(current.value.value)}"; ${candidate.evidence.map((item) => item.label).join("; ")} indicates "${String(validation.value.state === "provided" ? validation.value.value : validation.value.state)}". Check which is right. Nothing has been changed.`,
        evidence: { currentValueId: current.id, proposedValue: validation.value, evidence: candidate.evidence },
      });
      continue;
    }
    const baseValueId = current?.id ?? null;
    const inputVersion = await sha({ evidence: candidate.evidence.map((item) => ({ id: item.id, context: item.context ?? null })).sort((a, b) => a.id.localeCompare(b.id)), baseValueId });
    proposals.push({
      fieldPath: resolved.path,
      proposedValue: validation.value,
      valueType: resolved.field.type,
      evidenceRefs: candidate.evidence,
      originClass: candidate.origin,
      limitations: candidate.limitations,
      baseValueId,
      inputVersion,
      dedupeKey: `${resolved.path}:${await sha(validation.value)}:${inputVersion}`,
      generator: SOURCED_GENERATOR,
      modelVersion: "none",
      promptVersion: "none",
      knowledgeVersion: "none",
    });
  }
  return { proposals, discrepancies };
}
