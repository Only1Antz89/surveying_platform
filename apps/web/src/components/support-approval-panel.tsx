"use client";
import {workspaceFetch} from "@/lib/workspace-request";

import { useState } from "react";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import type { SupportAccessRequest } from "@/lib/data";

const dateTime = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });

export function SupportApprovalPanel({ initialRequests, organisationSlug }: { initialRequests: SupportAccessRequest[]; organisationSlug?: string }) {
  const [requests, setRequests] = useState(initialRequests);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(id: string, decision: "approve" | "deny") {
    try {
      setWorkingId(id);
      setError(null);
      setMessage(null);
      const response = await workspaceFetch(`/api/v1/support-sessions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(organisationSlug ? { "x-demo-organisation-slug": organisationSlug } : {}) },
        body: JSON.stringify({ decision }),
      });
      const payload = await response.json();
      setWorkingId(null);
      if (!response.ok) {
        setError(payload?.error?.message ?? "The support access request could not be updated.");
        return;
      }
      setRequests((current) => current.filter((request) => request.id !== id));
      setMessage(decision === "approve" ? "Write support access approved and audited." : "Write support access denied and audited.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "The support request failed. Please retry.");
    } finally { setWorkingId(null); }
  }

  return <section className="panel">
    <div className="panel-header"><div><h2>Support access approvals</h2><p>Only practice owners can approve time-limited write access for Surveynt support.</p></div><ShieldCheck size={17} color="#3b82f6" /></div>
    {message ? <div className="form-section"><p className="form-success" role="status"><CheckCircle2 size={15} />{message}</p></div> : null}
    {error ? <div className="form-section"><p className="form-error" role="alert">{error}</p></div> : null}
    {requests.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Ticket</th><th>Reason</th><th>Requested</th><th>Expires</th><th>Decision</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td data-label="Ticket"><strong>{request.ticketReference}</strong></td><td data-label="Reason">{request.reason}</td><td data-label="Requested">{dateTime(request.requestedAt)}</td><td data-label="Expires">{dateTime(request.expiresAt)}</td><td data-label="Decision"><div className="row-actions"><button className="button button-quiet" disabled={workingId === request.id} onClick={() => decide(request.id, "approve")}><CheckCircle2 size={14} />Approve</button><button className="button button-quiet danger" disabled={workingId === request.id} onClick={() => decide(request.id, "deny")}><XCircle size={14} />Deny</button></div></td></tr>)}</tbody></table></div> : <div className="empty-state compact"><strong>No support approvals awaiting you</strong><span>Write access remains unavailable unless an owner explicitly approves it.</span></div>}
  </section>;
}
