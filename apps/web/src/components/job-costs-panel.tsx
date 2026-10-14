"use client";
import { useEffect, useState } from "react";
import { Car, Clock, Receipt, Trash2 } from "lucide-react";
import { workspaceFetch } from "@/lib/workspace-request";
import { costSummary, expenseCategories, expenseLabels, hoursLabel, type CostEntry, type CostRates, type JobCostSummary } from "@/lib/job-costs-model";

type Data = { entries: CostEntry[]; summary: JobCostSummary; showsMoney: boolean; rates: CostRates | null };
type Kind = CostEntry["kind"];
const pounds = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const icons = { time: Clock, mileage: Car, expense: Receipt };
const describe = (entry: CostEntry) => entry.kind === "time" ? hoursLabel(entry.minutes ?? 0) : entry.kind === "mileage" ? `${entry.miles} miles` : `${pounds(entry.amountMinor ?? 0)} · ${expenseLabels[entry.category as keyof typeof expenseLabels] ?? "Expense"}`;

/** Time, mileage and expenses on the job record, with profit for management and finance. */
export function JobCostsPanel({ jobId, canRecord, currentUserId }: { jobId: string; canRecord: boolean; currentUserId: string | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [kind, setKind] = useState<Kind>("time");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { workspaceFetch(`/api/v1/jobs/${jobId}/costs`).then(async (response) => { const payload = await response.json(); if (response.ok) setData(payload.data); }).catch(() => undefined); }, [jobId]);
  if (!data) return null;

  async function add(form: FormData) {
    const body = kind === "time"
      ? { kind, occurredOn: form.get("occurredOn"), minutes: Number(form.get("hours") || 0) * 60 + Number(form.get("minutes") || 0), description: form.get("description") || null }
      : kind === "mileage" ? { kind, occurredOn: form.get("occurredOn"), miles: Math.round(Number(form.get("miles")) * 10) / 10, description: form.get("description") || null }
      : { kind, occurredOn: form.get("occurredOn"), amountMinor: Math.round(Number(form.get("amount")) * 100), category: form.get("category"), description: form.get("description") || null };
    setBusy(true); setMessage("");
    try {
      const response = await workspaceFetch(`/api/v1/jobs/${jobId}/costs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The entry could not be saved.");
      const entries = [payload.data as CostEntry, ...data!.entries];
      setData({ ...data!, entries, summary: recalc(data!, entries) });
      setMessage(payload.meta?.persisted === false ? "Preview only: shown here but not saved." : "Recorded.");
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function remove(entry: CostEntry) {
    setBusy(true); setMessage("");
    try {
      const response = await workspaceFetch(`/api/v1/jobs/${jobId}/costs/${entry.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The entry could not be removed.");
      const entries = data!.entries.filter((item) => item.id !== entry.id);
      setData({ ...data!, entries, summary: recalc(data!, entries) });
      setMessage(payload.meta?.persisted === false ? "Preview only: nothing was saved." : "Removed.");
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  const s = data.summary;
  return <section className="panel job-costs">
    <div className="panel-header"><div><h2>Time &amp; costs</h2><p>{data.showsMoney ? "Time at the practice's staff cost rate, mileage at its mileage rate, and expenses, against the agreed fee." : "Your time, mileage and expenses on this job."}</p></div></div>
    <div className="panel-body stack">
      <div className="cost-totals">
        <div><span>Time</span><strong>{hoursLabel(s.minutes)}</strong></div>
        <div><span>Mileage</span><strong>{s.miles} mi</strong></div>
        <div><span>Expenses</span><strong>{pounds(s.expensesMinor)}</strong></div>
        {data.showsMoney ? <><div><span>Total cost</span><strong>{pounds(s.totalCostMinor)}</strong></div><div><span>Fee</span><strong>{s.feeMinor != null ? pounds(s.feeMinor) : "Not set"}</strong></div><div className={s.profitMinor != null && s.profitMinor < 0 ? "loss" : ""}><span>Profit</span><strong>{s.profitMinor != null ? `${pounds(s.profitMinor)}${s.marginPercent != null ? ` · ${s.marginPercent}%` : ""}` : "—"}</strong></div></> : null}
      </div>
      {canRecord ? <form action={add} className="cost-form" key={`${kind}-${data.entries.length}`}>
        <div className="segmented" role="radiogroup" aria-label="What to record">{(["time", "mileage", "expense"] as const).map((value) => { const Icon = icons[value]; return <button key={value} type="button" role="radio" aria-checked={kind === value} className={kind === value ? "active" : ""} onClick={() => setKind(value)}><Icon size={14} />{value === "time" ? "Time" : value === "mileage" ? "Mileage" : "Expense"}</button>; })}</div>
        <div className="cost-fields">
          <div className="field"><label htmlFor="cost-date">Date</label><input id="cost-date" name="occurredOn" type="date" className="input" required defaultValue={today()} max={today()} /></div>
          {kind === "time" ? <><div className="field"><label htmlFor="cost-hours">Hours</label><input id="cost-hours" name="hours" type="number" min="0" max="24" step="1" className="input" defaultValue="1" /></div><div className="field"><label htmlFor="cost-minutes">Minutes</label><input id="cost-minutes" name="minutes" type="number" min="0" max="59" step="5" className="input" defaultValue="0" /></div></> : null}
          {kind === "mileage" ? <div className="field"><label htmlFor="cost-miles">Miles</label><input id="cost-miles" name="miles" type="number" min="0.1" max="2000" step="0.1" className="input" required /></div> : null}
          {kind === "expense" ? <><div className="field"><label htmlFor="cost-amount">Amount (£)</label><input id="cost-amount" name="amount" type="number" min="0.01" max="100000" step="0.01" className="input" required /></div><div className="field"><label htmlFor="cost-category">Category</label><select id="cost-category" name="category" className="select" defaultValue="travel">{expenseCategories.map((category) => <option key={category} value={category}>{expenseLabels[category]}</option>)}</select></div></> : null}
          <div className="field grow"><label htmlFor="cost-description">Note</label><input id="cost-description" name="description" className="input" maxLength={300} placeholder={kind === "time" ? "Inspection, drafting, travel…" : kind === "mileage" ? "Office to site and back" : "Receipt reference"} /></div>
        </div>
        <div className="form-actions"><button className="button button-primary" disabled={busy}>Record {kind}</button></div>
      </form> : null}
      {data.entries.length ? <ul className="cost-list">{data.entries.map((entry) => { const Icon = icons[entry.kind]; return <li key={entry.id}><Icon size={15} aria-hidden="true" /><div><strong>{describe(entry)}</strong><span className="cell-sub">{new Date(`${entry.occurredOn}T12:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium" })}{entry.userName ? ` · ${entry.userName}` : ""}{entry.description ? ` · ${entry.description}` : ""}</span></div>{canRecord && (data.showsMoney || entry.userId === currentUserId) ? <button type="button" className="icon-button danger" aria-label={`Remove ${describe(entry)}`} disabled={busy} onClick={() => void remove(entry)}><Trash2 size={14} /></button> : null}</li>; })}</ul> : <p className="muted">Nothing recorded yet.</p>}
      <p role="status" className="form-help">{message}</p>
    </div>
  </section>;
}

function recalc(data: Data, entries: CostEntry[]): JobCostSummary {
  const summary = costSummary(entries, data.rates ?? { staffCostRatePence: 0, mileageRatePence: 0 }, data.summary.feeMinor);
  return data.showsMoney ? summary : { ...summary, timeCostMinor: 0, mileageCostMinor: 0, totalCostMinor: summary.expensesMinor };
}
