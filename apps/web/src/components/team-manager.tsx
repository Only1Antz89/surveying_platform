"use client";

import { type FormEvent, useState } from "react";
import { MailPlus, RotateCcw, Trash2, X } from "lucide-react";
import { organisationRoles, roleLabels, type OrganisationRole } from "@fieldnote/domain";
import { StatusDot } from "@fieldnote/ui";
import type { Member } from "@/lib/demo-data";

type ApiInvitation = { id: string; email: string; role: OrganisationRole; expiresAt: string };

const toMember = (invitation: ApiInvitation): Member => ({
  id: invitation.id,
  name: invitation.email,
  email: invitation.email,
  initials: invitation.email.slice(0, 2).toUpperCase(),
  role: invitation.role,
  status: "Invited",
  workload: `Expires ${new Date(invitation.expiresAt).toLocaleDateString("en-GB")}`,
});

export function TeamManager({ members: initialMembers, canManage, actorRole }: { members: Member[]; canManage: boolean; actorRole: OrganisationRole }) {
  const [members, setMembers] = useState(initialMembers);
  const [inviting, setInviting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeOwnerCount = members.filter((member) => member.status === "Active" && member.role === "owner").length;

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/team/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), role: form.get("role") }),
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "The invitation could not be sent.");
      return;
    }
    setMembers((current) => [...current, toMember(payload.data)]);
    setInviting(false);
  }

  async function resend(id: string) {
    setWorkingId(id);
    setError(null);
    const response = await fetch(`/api/v1/team/invitations/${id}`, { method: "POST" });
    const payload = await response.json();
    setWorkingId(null);
    if (!response.ok) {
      setError(payload?.error?.message ?? "The invitation could not be resent.");
      return;
    }
    setMembers((current) => current.map((member) => member.id === id ? toMember(payload.data) : member));
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this pending invitation? Its existing acceptance link will stop working.")) return;
    setWorkingId(id);
    setError(null);
    const response = await fetch(`/api/v1/team/invitations/${id}`, { method: "DELETE" });
    const payload = await response.json();
    setWorkingId(null);
    if (!response.ok) {
      setError(payload?.error?.message ?? "The invitation could not be revoked.");
      return;
    }
    setMembers((current) => current.filter((member) => member.id !== id));
  }

  async function changeRole(id: string, role: OrganisationRole) {
    setWorkingId(id);
    setError(null);
    const response = await fetch(`/api/v1/team/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) });
    const payload = await response.json();
    setWorkingId(null);
    if (!response.ok) return setError(payload?.error?.message ?? "The member role could not be changed.");
    setMembers((current) => current.map((member) => member.id === id ? { ...member, role } : member));
  }

  async function removeMember(id: string) {
    if (!window.confirm("Remove this member from the practice workspace?")) return;
    setWorkingId(id);
    setError(null);
    const response = await fetch(`/api/v1/team/${id}`, { method: "DELETE" });
    const payload = await response.json();
    setWorkingId(null);
    if (!response.ok) return setError(payload?.error?.message ?? "The member could not be removed.");
    setMembers((current) => current.filter((member) => member.id !== id));
  }

  return <>
    <div className="page-action-row">{canManage ? <button className="button button-primary" onClick={() => setInviting(true)}><MailPlus size={15} />Invite teammate</button> : null}</div>
    <section className="panel">
      <div className="panel-header"><div><h2>Practice members</h2><p>{members.length} active and invited members</p></div></div>
      {error ? <div className="form-section"><p className="form-error" role="alert">{error}</p></div> : null}
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Workload</th>{canManage ? <th>Actions</th> : null}</tr></thead><tbody>{members.map((member) => { const finalOwner = member.status === "Active" && member.role === "owner" && activeOwnerCount <= 1; return <tr key={member.id}><td data-label="Member"><div style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="avatar">{member.initials}</span><span><strong>{member.name}</strong><span className="cell-sub">{member.email}</span></span></div></td><td data-label="Role">{canManage && member.status === "Active" ? <select className="select" aria-label={`Role for ${member.name}`} title={finalOwner ? "Add another owner before changing this role" : undefined} value={member.role} disabled={workingId === member.id || finalOwner || (actorRole !== "owner" && member.role === "owner")} onChange={(event) => changeRole(member.id, event.target.value as OrganisationRole)}>{organisationRoles.filter((role) => actorRole === "owner" || role !== "owner").map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select> : roleLabels[member.role]}</td><td data-label="Status"><StatusDot tone={member.status === "Active" ? "green" : "amber"}>{member.status}</StatusDot></td><td data-label="Workload">{member.workload}</td>{canManage ? <td data-label="Actions">{member.status === "Invited" ? <div className="row-actions"><button className="button button-quiet" onClick={() => resend(member.id)} disabled={workingId === member.id}><RotateCcw size={14} />Resend</button><button className="button button-quiet danger" onClick={() => revoke(member.id)} disabled={workingId === member.id}><Trash2 size={14} />Revoke</button></div> : <button className="button button-quiet danger" title={finalOwner ? "The final owner cannot be removed" : undefined} onClick={() => removeMember(member.id)} disabled={workingId === member.id || finalOwner || (actorRole !== "owner" && member.role === "owner")}><Trash2 size={14} />Remove</button>}</td> : null}</tr>; })}</tbody></table></div>
      {members.length === 0 ? <div className="empty-state"><strong>No members found</strong><span>Invite the first teammate to this workspace.</span></div> : null}
    </section>

    {inviting ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInviting(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="invite-title">
      <div className="modal-header"><div><h2 id="invite-title">Invite teammate</h2><p>Send a secure 14-day invitation to the practice workspace.</p></div><button className="icon-button" aria-label="Close invitation form" onClick={() => setInviting(false)}><X size={16} /></button></div>
      <form onSubmit={invite}><div className="form-section"><div className="form-grid">
        <div className="field full"><label htmlFor="invite-email">Email address</label><input id="invite-email" name="email" className="input" type="email" required autoFocus /></div>
        <div className="field full"><label htmlFor="invite-role">Workspace role</label><select id="invite-role" name="role" className="input" defaultValue="surveyor">{organisationRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></div>
      </div><p className="form-help">Owners and administrators can manage team access. All other roles receive only the permissions needed for their work.</p>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setInviting(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Sending…" : "Send invitation"}</button></div></form>
    </section></div> : null}
  </>;
}
