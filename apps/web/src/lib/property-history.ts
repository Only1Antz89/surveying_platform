import { and, asc, eq } from "drizzle-orm";
import { createDatabase, jobs, jobStageEvents, surveys, withTenant } from "@surveynt/db";
import { loadPropertyIntelligence, type IntelligenceCategoryView } from "./intelligence";

export type HistoryEvent = {
  id: string;
  kind: "sale" | "energy_certificate" | "listing" | "designation" | "job_stage" | "survey";
  title: string;
  detail: string | null;
  /** When the event happened (sale completion, inspection, listing, stage change). */
  eventDate: string | null;
  /** When the source published it (release, lodgement, list amendment), if known. */
  publishedDate: string | null;
  /** When Surveynt retrieved it; null for the firm's own records. */
  retrievedAt: string | null;
  origin: "external" | "firm";
  sourceKey: string | null;
  informationClass: string | null;
  /** The record was retrieved for an earlier property location or UPRN. */
  stale: boolean;
  evidence: { label: string; url: string }[];
  notes: string[];
};

export type HistoryCoverageNote = { label: string; status: string; message: string | null; stale: boolean };

export type PropertyHistory = { events: HistoryEvent[]; coverage: HistoryCoverageNote[] };

const stageLabels: Record<string, string> = {
  enquiry: "Enquiry", quoted: "Quoted", instructed: "Instructed", scheduled: "Inspection scheduled", inspection_complete: "Inspection complete",
  report_drafting: "Report drafting", internal_review: "Internal review", issued: "Report issued", paid: "Paid", archived: "Archived",
};

const pounds = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const isoDate = (value: unknown) => {
  const raw = text(value);
  if (!raw) return null;
  const match = /^(\d{4}-\d{2}(?:-\d{2})?)/.exec(raw);
  return match ? match[1] : null;
};

function externalEvents(category: IntelligenceCategoryView): HistoryEvent[] {
  const base = { origin: "external" as const, sourceKey: category.sourceKey, informationClass: category.informationClass, stale: category.stale, retrievedAt: category.retrievedAt };
  const evidence = (record: IntelligenceCategoryView["records"][number]) => (Array.isArray(record.evidence) ? record.evidence as { label: string; url: string }[] : []);
  switch (category.category) {
    case "sales_history":
      return category.records.map((record) => {
        const data = record.data as Record<string, unknown>;
        return {
          ...base, id: `sale:${record.snapshotId}`, kind: "sale" as const,
          title: `Sold for ${pounds.format(Number(data.price))}`,
          detail: [text(data.propertyTypeLabel), text(data.tenureLabel), data.newBuild ? "New build" : null, data.ppdCategory === "B" ? "Additional price paid category" : null].filter(Boolean).join(" · ") || null,
          eventDate: isoDate(data.transferDate), publishedDate: isoDate(data.releaseDate), evidence: evidence(record),
          notes: data.sharedSale ? [`This sale was linked to ${Number(data.linkedUprnCount)} properties; the price covers all of them.`] : [],
        };
      });
    case "energy_certificate":
      return category.records.map((record) => {
        const data = record.data as Record<string, unknown>;
        return {
          ...base, id: `epc:${record.snapshotId}`, kind: "energy_certificate" as const,
          title: `Energy certificate${text(data.currentRating) ? ` rated ${text(data.currentRating)}` : ""}`,
          detail: [text(data.propertyType), text(data.constructionAgeBand)].filter(Boolean).join(" · ") || null,
          eventDate: isoDate(data.inspectionDate) ?? isoDate(data.lodgementDate), publishedDate: isoDate(data.lodgementDate), evidence: evidence(record),
          notes: ["Event date is the assessment date where recorded; the certificate may be out of date."],
        };
      });
    case "listed_building_nhle":
      return category.records.map((record) => {
        const attributes = ((record.data as Record<string, unknown>).attributes ?? {}) as Record<string, unknown>;
        const grade = text(attributes.Grade);
        return {
          ...base, id: `listing:${record.snapshotId}`, kind: "listing" as const,
          title: grade ? `Listed, Grade ${grade}` : "Listed building",
          detail: text((record.data as Record<string, unknown>).name),
          eventDate: isoDate(attributes.ListDate), publishedDate: isoDate(attributes.AmendDate), evidence: evidence(record),
          notes: ["The list entry is the legal description."],
        };
      });
    default:
      // Planning designations with a recorded start date (for example a conservation area).
      if (category.sourceKey !== "planning_data") return [];
      return category.records.flatMap((record) => {
        const data = record.data as Record<string, unknown>;
        const start = isoDate(data.startDate);
        if (!start) return [];
        return [{
          ...base, id: `designation:${record.snapshotId}`, kind: "designation" as const,
          title: `${text(data.label) ?? "Planning designation"} designated`,
          detail: text(data.name), eventDate: start, publishedDate: null, evidence: evidence(record),
          notes: ["Planning coverage varies; confirm with the local planning authority."],
        }];
      });
  }
}

/**
 * A single timeline of external records and the firm's own job and survey
 * events for one property. Event, publication and retrieval dates are kept
 * apart; nothing here is inferred from addresses or nearby records.
 */
export async function loadPropertyHistory(context: { organisationId: string; internalUserId: string | null }, propertyId: string): Promise<PropertyHistory | null> {
  const intelligence = await loadPropertyIntelligence(context, propertyId);
  if (!intelligence) return null;
  const db = createDatabase();
  const firm = await withTenant(db, context.organisationId, async (tx) => {
    const stageRows = await tx.select({ id: jobStageEvents.id, toStage: jobStageEvents.toStage, reason: jobStageEvents.reason, createdAt: jobStageEvents.createdAt, reference: jobs.reference, serviceName: jobs.serviceName })
      .from(jobStageEvents).innerJoin(jobs, and(eq(jobStageEvents.jobId, jobs.id), eq(jobs.organisationId, context.organisationId)))
      .where(and(eq(jobStageEvents.organisationId, context.organisationId), eq(jobs.propertyId, propertyId))).orderBy(asc(jobStageEvents.createdAt)).limit(500);
    const surveyRows = await tx.select({ id: surveys.id, status: surveys.status, createdAt: surveys.createdAt, reference: jobs.reference })
      .from(surveys).innerJoin(jobs, and(eq(surveys.jobId, jobs.id), eq(jobs.organisationId, context.organisationId)))
      .where(and(eq(surveys.organisationId, context.organisationId), eq(surveys.propertyId, propertyId))).limit(200);
    return { stageRows, surveyRows };
  });
  const firmBase = { origin: "firm" as const, sourceKey: null, informationClass: null, stale: false, retrievedAt: null, publishedDate: null, evidence: [], notes: [] };
  const events: HistoryEvent[] = [
    ...intelligence.categories.filter((category) => category.status === "matched").flatMap(externalEvents),
    ...firm.stageRows.map((row) => ({ ...firmBase, id: `stage:${row.id}`, kind: "job_stage" as const, title: `${row.reference}: ${stageLabels[row.toStage] ?? row.toStage}`, detail: [row.serviceName, row.reason].filter(Boolean).join(" · ") || null, eventDate: row.createdAt.toISOString() })),
    ...firm.surveyRows.map((row) => ({ ...firmBase, id: `survey:${row.id}`, kind: "survey" as const, title: `${row.reference}: survey started`, detail: `Status: ${row.status.replace(/_/g, " ")}`, eventDate: row.createdAt.toISOString() })),
  ];
  events.sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? "") || a.id.localeCompare(b.id));
  const coverage: HistoryCoverageNote[] = [
    ["sales_history", "Sales (HM Land Registry Price Paid)"],
    ["energy_certificate", "Energy certificates"],
  ].map(([category, label]) => {
    const found = intelligence.categories.find((item) => item.category === category);
    return { label, status: found?.status ?? "not_checked", message: found?.message ?? "Not checked yet. Refresh property intelligence to check this source.", stale: found?.stale ?? false };
  });
  return { events, coverage };
}

/** Labelled development demo. None of these records are real. */
export const demoPropertyHistory: PropertyHistory = {
  events: [
    { id: "demo-stage-1", kind: "job_stage", title: "DEMO J-1042: Inspection scheduled", detail: "Level 2 survey", eventDate: "2026-09-28T09:00:00.000Z", publishedDate: null, retrievedAt: null, origin: "firm", sourceKey: null, informationClass: null, stale: false, evidence: [], notes: [] },
    { id: "demo-sale-1", kind: "sale", title: "DEMO: Sold for £425,000", detail: "Terraced · Freehold", eventDate: "2019-03-12", publishedDate: "2026-09", retrievedAt: "2026-10-01T08:00:00.000Z", origin: "external", sourceKey: "hmlr_price_paid", informationClass: "authoritative_external", stale: false, evidence: [], notes: ["Illustrative record for the demo workspace."] },
    { id: "demo-epc-1", kind: "energy_certificate", title: "DEMO: Energy certificate rated D", detail: "House · England and Wales: 1900-1929", eventDate: "2018-11-02", publishedDate: "2018-11-05", retrievedAt: "2026-10-01T08:00:00.000Z", origin: "external", sourceKey: "epc_england_wales", informationClass: "authoritative_external", stale: false, evidence: [], notes: ["Illustrative record for the demo workspace."] },
    { id: "demo-sale-2", kind: "sale", title: "DEMO: Sold for £182,500", detail: "Terraced · Freehold", eventDate: "2004-07-30", publishedDate: "2026-09", retrievedAt: "2026-10-01T08:00:00.000Z", origin: "external", sourceKey: "hmlr_price_paid", informationClass: "authoritative_external", stale: false, evidence: [], notes: ["Illustrative record for the demo workspace."] },
  ],
  coverage: [
    { label: "Sales (HM Land Registry Price Paid)", status: "matched", message: "Demo workspace: illustrative records, not live data.", stale: false },
    { label: "Energy certificates", status: "matched", message: "Demo workspace: illustrative records, not live data.", stale: false },
  ],
};
