"use client";
import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { workspaceFetch } from "@/lib/workspace-request";
import { downloadFile } from "@/lib/download";
import type { RequestView } from "@/lib/data-protection";

type Held = { clients: number; contacts: number; quotes: number; enquiries: number; jobs: number; properties: number; invoices: number; messages: number; signedTerms: number; legalHolds: number };
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/London" });
const heldLabels: [keyof Held, string][] = [["clients", "client records"], ["contacts", "contacts"], ["quotes", "quotes"], ["enquiries", "website enquiries"], ["jobs", "jobs"], ["properties", "properties"], ["invoices", "invoices"], ["messages", "messages"], ["signedTerms", "signed terms"], ["legalHolds", "legal holds"]];

/** Practice sign-in policy and data protection requests. */
export function SecurityPrivacySettings({ isOwner, canEdit, preview }: { isOwner: boolean; canEdit: boolean; preview: boolean }) {
  const [policy, setPolicy] = useState<{ requireTwoStep: boolean; sessionVerified: boolean } | null>(null);
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [held, setHeld] = useState<{ email: string; summary: Held } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [refusing, setRefusing] = useState<string | null>(null);
  useEffect(() => {
    workspaceFetch("/api/v1/organisation/security").then(async (response) => { if (response.ok) setPolicy((await response.json()).data); }).catch(() => undefined);
    workspaceFetch("/api/v1/privacy-requests").then(async (response) => { if (response.ok) setRequests((await response.json()).data); }).catch(() => undefined);
  }, []);

  async function togglePolicy(next: boolean) {
    setBusy(true); setMessage("");
    try {
      const response = await workspaceFetch("/api/v1/organisation/security", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ requireTwoStep: next }) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The policy could not be changed.");
      setPolicy((current) => current && { ...current, requireTwoStep: next });
      setMessage(payload.meta?.persisted === false ? "Preview only: not saved." : next ? "Two-step sign-in is now required. Staff without it are asked to set it up when they next open the workspace." : "Two-step sign-in is now optional.");
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function open(form: FormData) {
    setBusy(true); setMessage("");
    try {
      const response = await workspaceFetch("/api/v1/privacy-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subjectEmail: form.get("email"), kind: form.get("kind"), notes: form.get("notes") || null }) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The request could not be recorded.");
      setRequests((current) => [payload.data.request, ...current]); setHeld({ email: payload.data.request.subjectEmail, summary: payload.data.held });
      setMessage(`Request recorded. Respond by ${day(payload.data.request.dueAt)}.`);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function act(request: RequestView, body: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      if (body.action === "export") {
        await downloadFile(`/api/v1/privacy-requests/${request.id}`, "subject-access.json", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        setRequests((current) => current.map((item) => item.id === request.id ? { ...item, status: "completed", completedAt: new Date().toISOString() } : item));
        setMessage("Export downloaded and the request closed. Send the file to the person securely."); return;
      }
      const response = await workspaceFetch(`/api/v1/privacy-requests/${request.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The request could not be completed.");
      const updated: RequestView = body.action === "erase" ? payload.data.request : payload.data;
      setRequests((current) => current.map((item) => item.id === request.id ? updated : item)); setRefusing(null);
      setMessage(body.action === "erase" ? "Contact details erased. Records the practice must keep are listed against the request." : "Request refused and the reason recorded.");
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  return <div className="stack">
    <section className="panel">
      <div className="panel-header"><div><h2><KeyRound size={17} /> Sign-in security</h2><p>Require two-step sign-in (an authenticator app or another second step) for everyone in the practice.</p></div>{policy ? <StatusDot tone={policy.requireTwoStep ? "green" : "slate"}>{policy.requireTwoStep ? "Required" : "Optional"}</StatusDot> : null}</div>
      <div className="panel-body stack">
        {preview ? <p className="demo-banner">Preview: sign-in policy applies to practices using Surveynt sign-in.</p> : null}
        <label className="checkbox-row"><input type="checkbox" checked={policy?.requireTwoStep ?? false} disabled={!isOwner || !canEdit || busy || !policy} onChange={(event) => void togglePolicy(event.target.checked)} /> Require two-step sign-in for all staff</label>
        {policy && !policy.requireTwoStep && !policy.sessionVerified && !preview ? <p className="form-help">Set up two-step sign-in under Account → Security and sign in with it before turning this on.</p> : null}
        {!isOwner ? <p className="form-help">Only the practice owner can change this.</p> : null}
      </div>
    </section>
    <section className="panel">
      <div className="panel-header"><div><h2><ShieldCheck size={17} /> Data protection requests</h2><p>Record requests to see or erase personal data. You have one month to respond. Survey records, invoices and signed terms the practice must keep are retained and listed in the outcome.</p></div></div>
      <div className="panel-body stack">
        {canEdit ? <form action={open} className="form-grid">
          <div className="field"><label htmlFor="dsr-email">Person’s email address</label><input id="dsr-email" name="email" type="email" required className="input" maxLength={254} /></div>
          <div className="field"><label htmlFor="dsr-kind">Request</label><select id="dsr-kind" name="kind" className="select" defaultValue="access"><option value="access">See their data (access)</option><option value="erasure">Erase their data</option></select></div>
          <div className="field full"><label htmlFor="dsr-notes">Notes (how the request arrived, identity checks)</label><input id="dsr-notes" name="notes" className="input" maxLength={2000} /></div>
          <div className="form-actions"><button className="button button-primary" disabled={busy || preview}>Record request</button></div>
        </form> : null}
        {held ? <p className="notice">Held for {held.email}: {heldLabels.filter(([key]) => held.summary[key] > 0).map(([key, label]) => `${held.summary[key]} ${label}`).join(", ") || "nothing found"}.{held.summary.legalHolds ? " A linked job is under a hold; erasure is blocked until it is resolved." : ""}</p> : null}
        {requests.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Person</th><th>Request</th><th>Due</th><th>State</th>{canEdit ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead><tbody>{requests.map((request) => <tr key={request.id}>
          <td><strong>{request.subjectEmail}</strong>{request.notes ? <span className="cell-sub">{request.notes}</span> : null}</td>
          <td>{request.kind === "access" ? "Access" : "Erasure"}<span className="cell-sub">Received {day(request.requestedAt)}</span></td>
          <td>{request.status === "open" ? <StatusDot tone={new Date(request.dueAt) < new Date() ? "red" : "amber"}>{day(request.dueAt)}</StatusDot> : "—"}</td>
          <td><StatusDot tone={request.status === "completed" ? "green" : request.status === "refused" ? "slate" : "amber"}>{request.status === "open" ? "Open" : request.status === "completed" ? `Completed ${request.completedAt ? day(request.completedAt) : ""}` : "Refused"}</StatusDot>{request.outcome && Array.isArray((request.outcome as { retained?: unknown }).retained) ? <span className="cell-sub">Kept: {((request.outcome as { retained: string[] }).retained).join("; ") || "nothing"}</span> : null}</td>
          {canEdit ? <td>{request.status === "open" ? refusing === request.id ? <form className="inline-form" action={(form) => void act(request, { action: "refuse", reason: form.get("reason") })}><input name="reason" className="input" required minLength={10} maxLength={2000} placeholder="Reason for refusing" aria-label="Reason for refusing" /><button className="button button-quiet">Refuse</button></form> : <div className="action-row">{request.kind === "access" ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void act(request, { action: "export" })}>Download export</button> : <button type="button" className="button button-danger" disabled={busy} onClick={() => void act(request, { action: "erase", confirm: true })}>Erase contact details</button>}<button type="button" className="button button-quiet" disabled={busy} onClick={() => setRefusing(request.id)}>Refuse…</button></div> : null}</td> : null}
        </tr>)}</tbody></table></div> : <p className="muted">No requests recorded.</p>}
        <p role="status" className="form-help">{message}</p>
      </div>
    </section>
  </div>;
}
