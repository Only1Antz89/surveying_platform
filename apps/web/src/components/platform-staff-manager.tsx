"use client";
import {workspaceFetch} from "@/lib/workspace-request";

import { type FormEvent, useState } from "react";
import { Pencil, ShieldCheck, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { platformRoleLabels, platformRoles } from "@surveynt/domain";
import { StatusDot } from "@surveynt/ui";
import type { PlatformStaffRecord } from "@/lib/data";

const roles = platformRoles;
const roleLabel = (role: PlatformStaffRecord["role"]) => platformRoleLabels[role];

export function PlatformStaffManager({ staff, currentStaffId, canManage }: { staff: PlatformStaffRecord[]; currentStaffId: string; canManage: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlatformStaffRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, method: "POST" | "PATCH", body: unknown) {
    const response = await workspaceFetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message ?? "The platform access change could not be completed.");
    router.refresh();
  }

  async function createOperator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    const form = new FormData(event.currentTarget);
    try { await send("/api/platform/staff", "POST", { email: form.get("email"), role: form.get("role") }); setCreating(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The operator could not be added."); }
    finally { setSaving(false); }
  }

  async function updateOperator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true); setError(null);
    const form = new FormData(event.currentTarget);
    try { await send(`/api/platform/staff/${editing.id}`, "PATCH", { role: form.get("role"), active: form.get("active") === "true" }); setEditing(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The operator could not be updated."); }
    finally { setSaving(false); }
  }

  return <section className="panel"><div className="panel-header"><div><h2>Platform staff access</h2><p>Independent privileged access for Surveynt operations staff</p></div>{canManage ? <button className="button button-secondary" onClick={() => { setError(null); setCreating(true); }}><UserPlus size={15} />Add operator</button> : <ShieldCheck size={17} color="#3b82f6" />}</div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Operator</th><th>Role</th><th>Status</th><th>Last changed</th>{canManage ? <th>Action</th> : null}</tr></thead><tbody>{staff.map((operator) => <tr key={operator.id}><td data-label="Operator"><strong>{operator.name}{operator.id === currentStaffId ? " (you)" : ""}</strong><span className="cell-sub">{operator.email}</span></td><td data-label="Role">{roleLabel(operator.role)}</td><td data-label="Status"><StatusDot tone={operator.active ? "green" : "slate"}>{operator.active ? "Active" : "Access revoked"}</StatusDot></td><td data-label="Last changed">{new Date(operator.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" })}</td>{canManage ? <td data-label="Action"><button className="button button-quiet" onClick={() => { setError(null); setEditing(operator); }}><Pencil size={14} />Manage</button></td> : null}</tr>)}</tbody></table></div>
    {creating ? <StaffModal title="Add platform operator" description="The person must already have a verified Surveynt account." saving={saving} error={error} onClose={() => setCreating(false)} onSubmit={createOperator} /> : null}
    {editing ? <StaffModal title={editing.name} description={editing.id === currentStaffId ? "Your current super-administrator access is protected against self-lockout." : "Change the operator role or revoke their platform access."} staff={editing} protectAccess={editing.id === currentStaffId} saving={saving} error={error} onClose={() => setEditing(null)} onSubmit={updateOperator} /> : null}
  </section>;
}

function StaffModal({ title, description, staff, protectAccess = false, saving, error, onClose, onSubmit }: { title: string; description: string; staff?: PlatformStaffRecord; protectAccess?: boolean; saving: boolean; error: string | null; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="staff-modal-title"><div className="modal-header"><div><h2 id="staff-modal-title">{title}</h2><p>{description}</p></div><button className="icon-button" aria-label="Close platform access form" onClick={onClose}><X size={16} /></button></div><form onSubmit={onSubmit}><div className="form-section"><div className="form-grid">{staff ? null : <div className="field full"><label htmlFor="staff-email">Account email</label><input id="staff-email" name="email" className="input" type="email" autoComplete="email" required autoFocus /></div>}<div className="field full"><label htmlFor="staff-role">Platform role</label><select id="staff-role" name="role" className="input" defaultValue={staff?.role ?? "support"} disabled={protectAccess}>{roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select>{protectAccess ? <input type="hidden" name="role" value={staff?.role} /> : null}</div>{staff ? <div className="field full"><label htmlFor="staff-active">Access status</label><select id="staff-active" name="active" className="input" defaultValue={String(staff.active)} disabled={protectAccess}><option value="true">Active</option><option value="false">Revoked</option></select>{protectAccess ? <input type="hidden" name="active" value={String(staff.active)} /> : null}</div> : null}</div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving || protectAccess}>{saving ? "Saving…" : staff ? "Save access" : "Grant access"}</button></div></form></section></div>;
}
