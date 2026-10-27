"use client";
import {WorkspaceAnchor} from "@/components/workspace-anchor";

import {workspaceFetch} from "@/lib/workspace-request";
import { useEffect, useState } from "react";
import { Inbox } from "lucide-react";

const statusLabel = (status: string) => ({ new: "New", contacted: "Contacted", closed: "Closed" }[status] ?? status);
/** Turns stored field keys such as "postcode" or "propertyType" into readable labels. */
export const fieldLabel = (key: string) => { const words = key.replace(/[_-]+/g, " ").replace(/([a-z\d])([A-Z])/g, "$1 $2").trim().toLowerCase(); return words.charAt(0).toUpperCase() + words.slice(1); };
type Enquiry = { id: string; reference: string; firstName: string; lastName: string; email: string; phone: string | null; status: string; reason: string; isDemo: boolean; createdAt: string; address: Record<string, unknown>; answers: Record<string, unknown> };
export function WebsiteEnquiries({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Enquiry[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; workspaceFetch("/api/v1/operations/website-enquiries", { cache: "no-store" }).then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error?.message); if (active) setRows(p.data); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  async function update(id: string, status: string) { setBusy(true); setError(""); try { const r = await workspaceFetch("/api/v1/operations/website-enquiries", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) }); const p = await r.json(); if (!r.ok) throw new Error(p.error?.message); setRows(rows => rows.map(row => row.id === id ? p.data : row)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <section className="panel" aria-labelledby="website-enquiries-title">
    <div className="panel-header"><div><h2 id="website-enquiries-title"><Inbox size={16} aria-hidden="true" />Website enquiries</h2><p>Bespoke requests awaiting a supported quote. Customer statements are not survey findings. Showing the latest 100.</p></div></div>
    {error ? <p className="form-error enquiry-error" role="alert">{error}</p> : null}
    {loading ? <div className="empty-state compact" role="status">Loading enquiries…</div>
      : !rows.length ? <div className="empty-state"><Inbox size={24} aria-hidden="true" /><strong>No website enquiries yet</strong><span>Requests sent through your website form will appear here for follow-up.</span></div>
      : <ul className="enquiry-list">{rows.map(row => <li key={row.id}><details className="enquiry-item">
        <summary><span className="enquiry-name"><strong>{row.firstName} {row.lastName}</strong><small>{row.reference}{row.isDemo ? " · Simulated" : ""}</small></span><span className={`status ${row.status === "new" ? "status-blue" : row.status === "contacted" ? "status-amber" : ""}`}><i />{statusLabel(row.status)}</span></summary>
        <div className="enquiry-body">
          {row.reason ? <p>{row.reason}</p> : null}
          <p className="enquiry-contact"><WorkspaceAnchor href={`mailto:${row.email}`}>{row.email}</WorkspaceAnchor>{row.phone ? <span>{row.phone}</span> : null}</p>
          <dl className="enquiry-details">{Object.entries({ ...row.address, ...row.answers }).map(([key, value]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}</dl>
          <label className="field enquiry-status-field">Status<select className="input" value={row.status} disabled={!canEdit || busy} onChange={e => void update(row.id, e.target.value)}><option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option></select></label>
        </div>
      </details></li>)}</ul>}
  </section>;
}
