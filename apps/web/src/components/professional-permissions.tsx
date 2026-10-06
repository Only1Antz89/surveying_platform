"use client";
import { FormEvent, useState } from "react";
import { canReceiveProfessionalPermissions, type OrganisationRole, type ProfessionalPermission } from "@surveynt/domain";

export type PermissionMember = { id: string; name: string; role: OrganisationRole; status: string; canRecordSurvey?: boolean; canApproveReports?: boolean };
export function ProfessionalPermissions({ members }: { members: PermissionMember[] }) {
  const [rows, setRows] = useState(members);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const id = String(form.get("member"));
    const permission = String(form.get("permission")) as ProfessionalPermission;
    try {
      const response = await fetch(`/api/v1/team/${id}/permissions`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ permission, enabled: form.get("action") === "grant", reason: form.get("reason") }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Permission could not be changed.");
      setRows(current => current.map(row => row.id === id ? { ...row, ...payload.data } : row));
      setMessage("Permission saved and audited. The member should reload their workspace.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Permission could not be changed."); }
    finally { setBusy(false); }
  }
  const eligible = rows.filter(row => row.status === "Active" && canReceiveProfessionalPermissions(row.role));
  return <section className="panel"><div className="panel-header"><div><h2>Professional permissions</h2><p>Owner-only grants. Management roles do not automatically authorise professional findings or report approval. These permissions do not verify qualifications.</p></div></div><div className="panel-body">
    <ul>{eligible.map(row => <li key={row.id}><strong>{row.name}</strong> — Recording: {row.role === "surveyor" || row.canRecordSurvey ? "Allowed" : "Not granted"}; Approval: {row.canApproveReports ? "Allowed" : "Not granted"}</li>)}</ul>
    <form className="form-section" onSubmit={save}><div className="form-grid">
      <div className="field"><label htmlFor="permission-member">Member</label><select id="permission-member" name="member" className="select" required>{eligible.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div>
      <div className="field"><label htmlFor="professional-permission">Permission</label><select id="professional-permission" name="permission" className="select"><option value="record_survey">Record professional survey information</option><option value="approve_reports">Approve / issue survey reports</option></select></div>
      <div className="field"><label htmlFor="permission-action">Action</label><select id="permission-action" name="action" className="select"><option value="grant">Grant</option><option value="revoke">Revoke</option></select></div>
      <div className="field"><label htmlFor="permission-reason">Audit reason</label><input id="permission-reason" name="reason" className="input" required minLength={5} maxLength={1000} /></div>
    </div><p className="muted">Surveyors inherit recording rights for assigned work. To remove that access, change their role or assignment. Approval is always explicitly granted.</p><button className="button button-primary" disabled={busy || !eligible.length}>{busy ? "Saving…" : "Save professional permission"}</button><p role="status">{message}</p></form>
  </div></section>;
}
