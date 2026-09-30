"use client";

import { type FormEvent, useState } from "react";
import { Ban, CheckCircle2, Headphones, ShieldAlert, ShieldCheck, X } from "lucide-react";
import type { OrganisationStatus } from "@fieldnote/domain";

export function TenantControls({ tenantId, initialStatus, canManage, canSupport, canBreakGlass }: { tenantId: string; initialStatus: OrganisationStatus; canManage: boolean; canSupport: boolean; canBreakGlass: boolean }) {
  const [status, setStatus] = useState(initialStatus);
  const [targetStatus, setTargetStatus] = useState<"active" | "suspended" | null>(null);
  const [requestingSupport, setRequestingSupport] = useState<"standard" | "breakGlass" | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetStatus) return;
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/platform/tenants/${tenantId}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: targetStatus, reason: form.get("reason") }),
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "The tenant status could not be changed.");
      return;
    }
    setStatus(payload.data.status);
    setMessage(payload.data.status === "suspended" ? "Tenant access suspended and audited." : "Tenant access restored and audited.");
    setTargetStatus(null);
  }

  async function requestSupport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    const form = new FormData(event.currentTarget);
    const breakGlass = requestingSupport === "breakGlass";
    const response = await fetch(`/api/platform/tenants/${tenantId}/support-sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticketReference: form.get("ticketReference"), reason: form.get("reason"), permission: breakGlass ? "write" : form.get("permission"), breakGlass }) });
    const payload = await response.json(); setSaving(false);
    if (!response.ok) return setError(payload?.error?.message ?? "The support session could not be requested.");
    setRequestingSupport(null);
    if (payload.data.url) window.location.assign(payload.data.url);
    else setMessage("Write access requested. It remains unavailable until a tenant owner approves it.");
  }

  return <>
    <div className="support-banner" style={{ margin: "0 0 20px" }}><ShieldCheck />Customer workspace access requires a separate timed support session. Tenant controls do not impersonate customer accounts.</div>
    {(canManage && (status === "active" || status === "suspended")) || canSupport ? <div className="admin-actions" style={{ padding: 0, border: 0 }}>
      {canManage && (status === "active" || status === "suspended") ? <button className={`button ${status === "suspended" ? "button-primary" : "button-secondary"}`} onClick={() => { setError(null); setTargetStatus(status === "suspended" ? "active" : "suspended"); }}>{status === "suspended" ? <CheckCircle2 size={15} /> : <Ban size={15} />}{status === "suspended" ? "Reactivate tenant" : "Suspend tenant"}</button> : null}
      {canSupport ? <button className="button button-secondary" onClick={() => { setError(null); setRequestingSupport("standard"); }}><Headphones size={15} />Request support access</button> : null}
      {canBreakGlass ? <button className="button button-secondary danger" onClick={() => { setError(null); setRequestingSupport("breakGlass"); }}><ShieldAlert size={15} />Emergency access</button> : null}
    </div> : <p className="cell-sub">Your platform role has read-only access to tenant lifecycle controls.</p>}
    {message ? <div className="toast" role="status"><CheckCircle2 size={15} />{message}</div> : null}
    {targetStatus ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTargetStatus(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="tenant-status-title">
      <div className="modal-header"><div><h2 id="tenant-status-title">{targetStatus === "suspended" ? "Suspend tenant access" : "Reactivate tenant access"}</h2><p>This high-impact action is recorded in the immutable platform audit trail.</p></div><button className="icon-button" aria-label="Close tenant status form" onClick={() => setTargetStatus(null)}><X size={16} /></button></div>
      <form onSubmit={changeStatus}><div className="form-section"><div className="field"><label htmlFor="tenant-status-reason">Reason</label><textarea id="tenant-status-reason" name="reason" className="input" rows={4} minLength={10} maxLength={500} required autoFocus placeholder={targetStatus === "suspended" ? "Explain why customer access must be suspended" : "Explain why customer access can be restored"} /></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setTargetStatus(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : targetStatus === "suspended" ? "Confirm suspension" : "Confirm reactivation"}</button></div></form>
    </section></div> : null}
    {requestingSupport ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRequestingSupport(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="support-session-title"><div className="modal-header"><div><h2 id="support-session-title">{requestingSupport === "breakGlass" ? "Start emergency support access" : "Request support access"}</h2><p>{requestingSupport === "breakGlass" ? "Super administrators receive audited write access for 15 minutes. Tenant owners and platform administrators are notified." : "Read access opens immediately for 60 minutes. Write access requires tenant-owner approval."}</p></div><button className="icon-button" aria-label="Close support request" onClick={() => setRequestingSupport(null)}><X size={16} /></button></div><form onSubmit={requestSupport}><div className="form-section"><div className="form-grid"><div className="field"><label htmlFor="support-ticket">Ticket reference</label><input id="support-ticket" name="ticketReference" className="input" required minLength={3} maxLength={80} autoFocus /></div>{requestingSupport === "standard" ? <div className="field"><label htmlFor="support-permission">Permission</label><select id="support-permission" name="permission" className="input" defaultValue="read"><option value="read">Read only</option><option value="write">Write — owner approval required</option></select></div> : <div className="field"><label>Permission</label><div className="input" aria-label="Permission">Emergency write · 15 minutes</div></div>}<div className="field full"><label htmlFor="support-reason">Reason</label><textarea id="support-reason" name="reason" className="input" rows={4} required minLength={10} maxLength={500} /></div></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setRequestingSupport(null)}>Cancel</button><button className={`button ${requestingSupport === "breakGlass" ? "button-secondary danger" : "button-primary"}`} disabled={saving}>{saving ? "Requesting…" : requestingSupport === "breakGlass" ? "Start 15-minute emergency access" : "Create support session"}</button></div></form></section></div> : null}
  </>;
}
