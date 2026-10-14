import type { OrganisationRole } from "@surveynt/domain";
import { jobs } from "./demo-data";
import { costSummary, type CostEntry } from "./job-costs-model";

const rates = { staffCostRatePence: 3500, mileageRatePence: 45 };
const entries = (jobId: string): CostEntry[] => jobId === "job_01" ? [
  { id: "c1", kind: "time", occurredOn: "2026-10-08", minutes: 180, miles: null, amountMinor: null, category: null, description: "Inspection", userId: "u-maya", userName: "Maya Patel", createdAt: "2026-10-08T16:00:00Z" },
  { id: "c2", kind: "time", occurredOn: "2026-10-09", minutes: 240, miles: null, amountMinor: null, category: null, description: "Report drafting", userId: "u-maya", userName: "Maya Patel", createdAt: "2026-10-09T17:00:00Z" },
  { id: "c3", kind: "mileage", occurredOn: "2026-10-08", minutes: null, miles: 18.4, amountMinor: null, category: null, description: "Office to site and back", userId: "u-maya", userName: "Maya Patel", createdAt: "2026-10-08T16:05:00Z" },
  { id: "c4", kind: "expense", occurredOn: "2026-10-08", minutes: null, miles: null, amountMinor: 850, category: "parking", description: "Pay and display", userId: "u-maya", userName: "Maya Patel", createdAt: "2026-10-08T16:06:00Z" },
] : [];

/** Fictional costs for the local preview. */
export function demoJobCosts(jobId: string, role: OrganisationRole) {
  const money = ["owner", "administrator", "manager", "finance"].includes(role);
  const job = jobs.find((item) => item.id === jobId);
  const list = entries(jobId);
  const summary = costSummary(list, rates, money && job?.fee != null ? job.fee * 100 : null);
  return { entries: list, summary, showsMoney: money, rates: money ? rates : null };
}

export function demoProfitability() {
  const rows = jobs.slice(0, 5).map((job, index) => {
    const minutes = [420, 300, 360, 600, 240][index], miles = [18.4, 6, 32, 12, 9][index], expenses = [850, 0, 1200, 0, 400][index];
    const summary = costSummary([{ kind: "time", minutes, miles: null, amountMinor: null }, { kind: "mileage", minutes: null, miles, amountMinor: null }, { kind: "expense", minutes: null, miles: null, amountMinor: expenses }], rates, job.fee != null ? job.fee * 100 : null);
    return { jobId: job.id, reference: job.reference, serviceName: job.service, stage: job.stage, feeMinor: summary.feeMinor, costMinor: summary.totalCostMinor, profitMinor: summary.profitMinor, marginPercent: summary.marginPercent, minutes };
  });
  const services = [...new Set(rows.map((row) => row.serviceName))].map((service) => { const list = rows.filter((row) => row.serviceName === service); const fee = list.reduce((s, r) => s + (r.feeMinor ?? 0), 0), cost = list.reduce((s, r) => s + r.costMinor, 0); return { service, jobs: list.length, feeMinor: fee, costMinor: cost, marginPercent: fee ? Math.round((fee - cost) / fee * 1000) / 10 : null, averageMinutes: Math.round(list.reduce((s, r) => s + r.minutes, 0) / list.length) }; });
  return { rows, services, rates, days: 90 };
}
