"use client";
import { useEffect, useState } from "react";
import Link from "./workspace-link";
import { TrendingUp } from "lucide-react";
import { workspaceFetch } from "@/lib/workspace-request";
import { hoursLabel } from "@/lib/job-costs-model";
import type { ProfitRow } from "@/lib/job-costs";

type Data = { rows: ProfitRow[]; services: { service: string; jobs: number; feeMinor: number; costMinor: number; marginPercent: number | null; averageMinutes: number }[]; rates: { staffCostRatePence: number; mileageRatePence: number }; days: number };
const pounds = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(minor / 100);

/** Job and service margins from recorded time, mileage and expenses. */
export function JobProfitability({ slug, canEditRate }: { slug: string; canEditRate: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [rate, setRate] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => { workspaceFetch("/api/v1/finance/profitability").then(async (response) => { const payload = await response.json(); if (!response.ok) throw Error(payload.error?.message ?? "Profitability is unavailable."); setData(payload.data); setRate(String(payload.data.rates.staffCostRatePence / 100)); }).catch((reason: Error) => setError(reason.message)); }, []);
  async function saveRate(event: React.FormEvent) {
    event.preventDefault(); setStatus("");
    const response = await workspaceFetch("/api/v1/finance/profitability", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ staffCostRatePence: Math.round(Number(rate) * 100) }) });
    const payload = await response.json();
    if (!response.ok) { setStatus(payload.error?.message ?? "The rate could not be saved."); return; }
    setStatus(payload.meta?.persisted === false ? "Preview only: not saved." : "Rate saved. Margins use the new rate when you reload.");
  }
  return <section className="panel">
    <div className="panel-header"><div><h2><TrendingUp size={17} /> Job profitability</h2><p>Last {data?.days ?? 90} days. Fee less time at the staff cost rate, mileage at {data ? `${data.rates.mileageRatePence}p a mile` : "the mileage rate"} and expenses. Jobs without recorded costs are not shown.</p></div></div>
    <div className="panel-body stack">
      {error ? <p className="form-error">{error}</p> : null}
      {canEditRate && data ? <form className="inline-form" onSubmit={saveRate}><label htmlFor="staff-rate">Staff cost per hour (£)</label><input id="staff-rate" className="input" type="number" min="0" max="1000" step="0.5" value={rate} onChange={(event) => setRate(event.target.value)} /><button className="button button-secondary">Save rate</button><span role="status" className="form-help">{status}</span></form> : null}
      {data?.services.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Service</th><th>Jobs</th><th>Fees</th><th>Costs</th><th>Margin</th><th>Average time</th></tr></thead><tbody>{data.services.map((row) => <tr key={row.service}><td><strong>{row.service}</strong></td><td>{row.jobs}</td><td>{pounds(row.feeMinor)}</td><td>{pounds(row.costMinor)}</td><td className={row.marginPercent != null && row.marginPercent < 0 ? "negative" : ""}>{row.marginPercent != null ? `${row.marginPercent}%` : "—"}</td><td>{hoursLabel(row.averageMinutes)}</td></tr>)}</tbody></table></div> : null}
      {data?.rows.length ? <details><summary>Jobs ({data.rows.length})</summary><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Job</th><th>Fee</th><th>Cost</th><th>Profit</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.jobId}><td><Link href={`/app/${slug}/jobs/${row.jobId}`}>{row.reference}</Link><span className="cell-sub">{row.serviceName}</span></td><td>{row.feeMinor != null ? pounds(row.feeMinor) : "Not set"}</td><td>{pounds(row.costMinor)}</td><td className={row.profitMinor != null && row.profitMinor < 0 ? "negative" : ""}>{row.profitMinor != null ? `${pounds(row.profitMinor)}${row.marginPercent != null ? ` · ${row.marginPercent}%` : ""}` : "—"}</td></tr>)}</tbody></table></div></details> : data ? <div className="empty-state compact"><strong>No costs recorded yet</strong><span>Record time, mileage and expenses on each job record to see margins here.</span></div> : null}
    </div>
  </section>;
}
