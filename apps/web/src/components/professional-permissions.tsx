"use client";

import { FormEvent, useState } from "react";
import { AlertCircle, CheckCircle2, ShieldCheck, UserCheck } from "lucide-react";
import {
  canReceiveProfessionalPermissions,
  type OrganisationRole,
  type ProfessionalPermission,
} from "@surveynt/domain";

export type PermissionMember = {
  id: string;
  name: string;
  role: OrganisationRole;
  status: string;
  canRecordSurvey?: boolean;
  canApproveReports?: boolean;
};

export function ProfessionalPermissions({ members }: { members: PermissionMember[] }) {
  const [rows, setRows] = useState(members);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const id = String(form.get("member"));
    const permission = String(form.get("permission")) as ProfessionalPermission;
    try {
      const response = await fetch(`/api/v1/team/${id}/permissions`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          permission,
          enabled: form.get("action") === "grant",
          reason: form.get("reason"),
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error?.message ?? "Permission could not be changed.");
      setRows((current) =>
        current.map((row) => (row.id === id ? { ...row, ...payload.data } : row))
      );
      setMessage("Permission saved and audited. The member should reload their workspace.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Permission could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  const eligible = rows.filter(
    (row) => row.status === "Active" && canReceiveProfessionalPermissions(row.role)
  );

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Professional permissions</h2>
          <p>
            Owner-only grants. Management roles do not automatically authorise professional
            findings or report approval. These permissions do not verify qualifications.
          </p>
        </div>
      </div>
      <div className="panel-body">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
          {eligible.map((row) => {
            const recordingAllowed = row.role === "surveyor" || Boolean(row.canRecordSurvey);
            return (
              <div key={row.id} className="deposit-item">
                <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                  <UserCheck size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
                  <strong>{row.name}</strong>
                  <span className="muted-text" style={{ fontSize: "0.8125rem" }}>({row.role})</span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                  <span className={`status ${recordingAllowed ? "status-green" : "status-slate"}`}>
                    Recording: {recordingAllowed ? "Allowed" : "Not granted"}
                  </span>
                  <span className={`status ${row.canApproveReports ? "status-green" : "status-slate"}`}>
                    Approval: {row.canApproveReports ? "Allowed" : "Not granted"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <form className="form-section" onSubmit={save}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="permission-member">Member</label>
              <select id="permission-member" name="member" className="select" required>
                {eligible.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="professional-permission">Permission</label>
              <select id="professional-permission" name="permission" className="select">
                <option value="record_survey">Record professional survey information</option>
                <option value="approve_reports">Approve / issue survey reports</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="permission-action">Action</label>
              <select id="permission-action" name="action" className="select">
                <option value="grant">Grant</option>
                <option value="revoke">Revoke</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="permission-reason">Audit reason</label>
              <input
                id="permission-reason"
                name="reason"
                className="input"
                required
                minLength={5}
                maxLength={1000}
                placeholder="Reason for granting or revoking permission"
              />
            </div>
          </div>
          <p className="form-help">
            Surveyors inherit recording rights for assigned work. To remove that access, change
            their role or assignment. Approval is always explicitly granted.
          </p>
          <div className="action-row" style={{ marginTop: "1rem" }}>
            <button className="button button-primary" disabled={busy || !eligible.length}>
              <ShieldCheck size={14} />
              {busy ? "Saving…" : "Save professional permission"}
            </button>
          </div>
          {message ? (
            <div
              className={`form-${message.includes("could not") ? "error" : "success"}`}
              role="status"
              style={{ marginTop: "1rem" }}
            >
              {message.includes("could not") ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
              <span>{message}</span>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
