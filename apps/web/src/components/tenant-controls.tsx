"use client";

import { type FormEvent, useState } from "react";
import { Ban, CheckCircle2, ShieldCheck, X } from "lucide-react";
import type { OrganisationStatus } from "@fieldnote/domain";

export function TenantControls({ tenantId, initialStatus, canManage }: { tenantId: string; initialStatus: OrganisationStatus; canManage: boolean }) {
  const [status, setStatus] = useState(initialStatus);
  const [targetStatus, setTargetStatus] = useState<"active" | "suspended" | null>(null);
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

  return <>
    <div className="support-banner" style={{ margin: "0 0 20px" }}><ShieldCheck />Customer workspace access requires a separate timed support session. Tenant controls do not impersonate customer accounts.</div>
    {canManage && (status === "active" || status === "suspended") ? <div className="admin-actions" style={{ padding: 0, border: 0 }}>
      <button className={`button ${status === "suspended" ? "button-primary" : "button-secondary"}`} onClick={() => { setError(null); setTargetStatus(status === "suspended" ? "active" : "suspended"); }}>{status === "suspended" ? <CheckCircle2 size={15} /> : <Ban size={15} />}{status === "suspended" ? "Reactivate tenant" : "Suspend tenant"}</button>
    </div> : <p className="cell-sub">{canManage ? "This tenant cannot be changed from its current lifecycle state." : "Your platform role has read-only access to tenant lifecycle controls."}</p>}
    {message ? <div className="toast" role="status"><CheckCircle2 size={15} />{message}</div> : null}
    {targetStatus ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTargetStatus(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="tenant-status-title">
      <div className="modal-header"><div><h2 id="tenant-status-title">{targetStatus === "suspended" ? "Suspend tenant access" : "Reactivate tenant access"}</h2><p>This high-impact action is recorded in the immutable platform audit trail.</p></div><button className="icon-button" aria-label="Close tenant status form" onClick={() => setTargetStatus(null)}><X size={16} /></button></div>
      <form onSubmit={changeStatus}><div className="form-section"><div className="field"><label htmlFor="tenant-status-reason">Reason</label><textarea id="tenant-status-reason" name="reason" className="input" rows={4} minLength={10} maxLength={500} required autoFocus placeholder={targetStatus === "suspended" ? "Explain why customer access must be suspended" : "Explain why customer access can be restored"} /></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setTargetStatus(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : targetStatus === "suspended" ? "Confirm suspension" : "Confirm reactivation"}</button></div></form>
    </section></div> : null}
  </>;
}
