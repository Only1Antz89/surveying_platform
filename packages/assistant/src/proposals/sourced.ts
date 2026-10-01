import { canonicalJson, resolveField, validateFieldValue } from "../forms/validate";
import type { FieldValue, FormTemplate } from "../forms/types";
import type { DiscrepancyDraft, EvidenceRef, ProposalDraft } from "./types";

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
};

export type CurrentValue = { id: string; value: FieldValue };

export type SourcedInput = {
  template: FormTemplate;
  snapshots: SnapshotEvidence[];
  currentValues: Map<string, CurrentValue>;
  job: { id: string; reference: string; targetDate: string | null };
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
  }

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
    const inputVersion = await sha({ evidence: candidate.evidence.map((item) => item.id).sort(), baseValueId });
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
