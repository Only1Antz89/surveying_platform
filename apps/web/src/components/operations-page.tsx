import { AlertTriangle, CheckCircle2, Clock3, type LucideIcon } from "lucide-react";
import { StatusDot } from "@fieldnote/ui";
import { ActionButton } from "./action-feedback";
import { PageHeader } from "./page-header";

export type OperationRow = { primary: string; secondary: string; state: string; detail: string; action: string; tone?: "blue" | "green" | "amber" | "red" | "slate" };

export function OperationsPage({ title, description, icon: Icon, rows, emptyMessage }: { title: string; description: string; icon: LucideIcon; rows: OperationRow[]; emptyMessage?: string }) {
  return <main className="page"><PageHeader eyebrow="Platform operations" title={title} description={description} /><section className="panel"><div className="panel-header"><div><h2>Current queue</h2><p>Live operational records for this workflow</p></div><Icon size={17} color="#2563eb" /></div>{rows.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Account / item</th><th>Status</th><th>Detail</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.primary}-${row.state}`}><td data-label="Account"><strong>{row.primary}</strong><span className="cell-sub">{row.secondary}</span></td><td data-label="Status"><StatusDot tone={row.tone ?? "slate"}>{row.state}</StatusDot></td><td data-label="Detail">{row.detail}</td><td data-label="Action"><ActionButton className="button button-quiet" message={`${row.action} opened`}>{row.action}</ActionButton></td></tr>)}</tbody></table></div> : <div style={{ padding: 50, textAlign: "center" }}><CheckCircle2 size={28} color="#15825e" /><h3>Queue clear</h3><p style={{ color: "#627086" }}>{emptyMessage}</p></div>}</section></main>;
}

export const onboardingRows: OperationRow[] = [
  { primary: "Mason & Vale", secondary: "Ruth Mason", state: "Checkout incomplete", detail: "Started 3 hours ago", action: "Review", tone: "amber" },
  { primary: "North Star Surveying", secondary: "Maya Patel", state: "86% complete", detail: "Missing initial teammate", action: "Open", tone: "blue" },
];
export const billingRows: OperationRow[] = [
  { primary: "Southbank Property Advisory", secondary: "Practice · 8 seats", state: "Past due", detail: "Grace ends 4 Oct 2026", action: "Review invoice", tone: "amber" },
  { primary: "Hart & Field Surveyors", secondary: "Studio · 3 seats", state: "Unpaid", detail: "Access restricted", action: "Resolve", tone: "red" },
];
export const supportRows: OperationRow[] = [
  { primary: "FN-2841", secondary: "North Star Surveying", state: "Awaiting approval", detail: "Read-only · 60 minutes", action: "Inspect request", tone: "blue" },
  { primary: "FN-2836", secondary: "Cedar Building Consultancy", state: "Expired", detail: "Closed 27 Sep 2026", action: "View audit", tone: "slate" },
];
export const packRows: OperationRow[] = [
  { primary: "RICS Home Survey Level 2", secondary: "Version 1.4", state: "Published", detail: "18 firms enabled", action: "View version", tone: "green" },
  { primary: "Commercial Building Survey", secondary: "Version 0.9", state: "Draft", detail: "12 sections · 84 fields", action: "Continue editing", tone: "amber" },
];
export const auditRows: OperationRow[] = [
  { primary: "support.session_requested", secondary: "Fieldnote Ops", state: "Recorded", detail: "North Star Surveying · FN-2841", action: "Inspect", tone: "blue" },
  { primary: "subscription.updated", secondary: "Stripe webhook", state: "Recorded", detail: "Southbank Property Advisory", action: "Inspect", tone: "green" },
  { primary: "tenant.suspended", secondary: "A. Operator", state: "Recorded", detail: "Hart & Field Surveyors", action: "Inspect", tone: "amber" },
];

export const operationIcons = { AlertTriangle, Clock3 };
