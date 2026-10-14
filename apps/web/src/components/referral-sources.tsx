"use client";
import { useEffect, useState } from "react";
import { Handshake, Plus } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { workspaceFetch } from "@/lib/workspace-request";
import type { ReferralSource } from "@/lib/referrals";

const kinds = { estate_agent: "Estate agent", mortgage_broker: "Mortgage broker", lender: "Lender", solicitor: "Solicitor or conveyancer", website: "Website or search", repeat_client: "Repeat client", other: "Other" } as const;
type Row = { source: ReferralSource; jobs: number; feesMinor: number; issued: number };
type Data = { sources: ReferralSource[]; report: Row[]; untracked: { jobs: number; feesMinor: number; issued: number }; total: number };
const pounds = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(minor / 100);

/** Where instructions come from, and what each source is worth over the last 12 months. */
export function ReferralSources({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { workspaceFetch("/api/v1/referral-sources").then(async (response) => { const payload = await response.json(); if (!response.ok) throw Error(payload.error?.message ?? "Referral sources are unavailable."); setData(payload.data); }).catch((error: Error) => setMessage(error.message)); }, []);

  async function create(form: FormData) {
    setBusy(true); setMessage("");
    try {
      const response = await workspaceFetch("/api/v1/referral-sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), kind: form.get("kind"), email: form.get("email") || null }) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The source could not be added.");
      setData((current) => current && { ...current, sources: [...current.sources, payload.data], report: [...current.report, { source: payload.data, jobs: 0, feesMinor: 0, issued: 0 }] });
      setAdding(false); setMessage(payload.meta?.persisted === false ? "Preview only: not saved." : `${payload.data.name} added. Tag jobs with it from the job record.`);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function toggle(source: ReferralSource) {
    setBusy(true); setMessage("");
    try {
      const response = await workspaceFetch("/api/v1/referral-sources", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: source.id, active: !source.active }) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The source could not be updated.");
      const update = (item: ReferralSource) => item.id === source.id ? { ...item, active: !source.active } : item;
      setData((current) => current && { ...current, sources: current.sources.map(update), report: current.report.map((row) => ({ ...row, source: update(row.source) })) });
      setMessage(payload.meta?.persisted === false ? "Preview only: not saved." : source.active ? `${source.name} archived. Existing jobs keep it.` : `${source.name} restored.`);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  return <section className="panel">
    <div className="panel-header"><div><h2><Handshake size={17} /> Referral sources</h2><p>Instructions and fees by source over the last 12 months{data ? ` · ${data.total} jobs` : ""}.</p></div>{canEdit && !adding ? <button type="button" className="button button-secondary" onClick={() => setAdding(true)}><Plus size={15} />Add source</button> : null}</div>
    <div className="panel-body stack">
      {adding ? <form action={create} className="form-grid">
        <div className="field"><label htmlFor="ref-name">Name</label><input id="ref-name" name="name" className="input" required minLength={2} maxLength={120} placeholder="Clifton Homes" /></div>
        <div className="field"><label htmlFor="ref-kind">Type</label><select id="ref-kind" name="kind" className="select" defaultValue="estate_agent">{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="field full"><label htmlFor="ref-email">Contact email (optional)</label><input id="ref-email" name="email" type="email" className="input" maxLength={254} /></div>
        <div className="form-actions"><button type="button" className="button button-quiet" onClick={() => setAdding(false)}>Cancel</button><button className="button button-primary" disabled={busy}>Add source</button></div>
      </form> : null}
      {data ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Source</th><th>Jobs</th><th>Issued</th><th>Fees</th><th>State</th>{canEdit ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead><tbody>
        {data.report.map((row) => <tr key={row.source.id}><td><strong>{row.source.name}</strong><span className="cell-sub">{kinds[row.source.kind]}</span></td><td>{row.jobs}</td><td>{row.issued}</td><td>{pounds(row.feesMinor)}</td><td><StatusDot tone={row.source.active ? "green" : "slate"}>{row.source.active ? "Active" : "Archived"}</StatusDot></td>{canEdit ? <td><button type="button" className="button button-quiet" disabled={busy} onClick={() => void toggle(row.source)}>{row.source.active ? "Archive" : "Restore"}</button></td> : null}</tr>)}
        <tr><td><strong>Not recorded</strong><span className="cell-sub">Jobs without a referral source</span></td><td>{data.untracked.jobs}</td><td>{data.untracked.issued}</td><td>{pounds(data.untracked.feesMinor)}</td><td /> {canEdit ? <td /> : null}</tr>
      </tbody></table></div> : null}
      <p role="status" className="form-help">{message}</p>
    </div>
  </section>;
}
