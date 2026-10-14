"use client";
import { useEffect, useState } from "react";
import { FileSignature } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import Link from "./workspace-link";
import { workspaceFetch } from "@/lib/workspace-request";
import { downloadFile } from "@/lib/download";

type Status = { required: boolean; current: { id: string; version: number; title: string } | null; acceptance: { version: number; signerName: string; signedAt: string; method: string } | null };
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/London" });

/** Job record: whether the client has signed the current terms, with a way to record a paper signature. */
export function EngagementPanel({ jobId, slug, canRecord }: { jobId: string; slug: string; canRecord: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { workspaceFetch(`/api/v1/jobs/${jobId}/engagement`).then(async (response) => { const payload = await response.json(); if (response.ok) setStatus(payload.data); }).catch(() => undefined); }, [jobId]);
  if (!status) return null;
  const signedCurrent = status.acceptance && status.current && status.acceptance.version === status.current.version;
  async function record(form: FormData) {
    setBusy(true); setMessage("");
    try {
      const response = await workspaceFetch(`/api/v1/jobs/${jobId}/engagement`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signerName: form.get("signerName"), signedOn: form.get("signedOn"), confirm: form.get("confirm") === "on" }) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The signature could not be recorded.");
      setStatus({ ...status!, acceptance: payload.data }); setRecording(false);
      setMessage(payload.meta?.persisted === false ? "Preview only: not saved." : "Signature recorded.");
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel">
    <div className="panel-header"><div><h2><FileSignature size={17} /> Terms of engagement</h2><p>{status.current ? `${status.current.title} · version ${status.current.version}` : "No terms published yet."}</p></div>
      {status.current ? <StatusDot tone={signedCurrent ? "green" : status.required ? "amber" : "slate"}>{signedCurrent ? "Signed" : status.acceptance ? "Earlier version signed" : status.required ? "Signature needed before booking" : "Not signed"}</StatusDot> : null}</div>
    <div className="panel-body stack">
      {status.acceptance ? <p>Signed by <strong>{status.acceptance.signerName}</strong> on {day(status.acceptance.signedAt)} (version {status.acceptance.version}){status.acceptance.method === "recorded_by_practice" ? ", recorded by the practice" : " in the client case page"}. <button type="button" className="button button-quiet" onClick={() => downloadFile(`/api/v1/jobs/${jobId}/engagement/pdf`, "signed-terms.pdf").catch((error: Error) => setMessage(error.message))}>Download signed copy</button></p> : status.current ? <p>The client can sign from their case page after paying the deposit.</p> : <p><Link href={`/app/${slug}/settings/operations?section=terms`}>Publish your terms of engagement</Link> so clients can sign them online.</p>}
      {canRecord && status.current && !signedCurrent ? recording ? <form action={record} className="form-grid">
        <div className="field"><label htmlFor="paper-signer">Signed by</label><input id="paper-signer" name="signerName" className="input" required minLength={2} maxLength={120} /></div>
        <div className="field"><label htmlFor="paper-date">Date signed</label><input id="paper-date" name="signedOn" type="date" className="input" required /></div>
        <label className="field full"><span><input type="checkbox" name="confirm" required /> I hold the signed copy of version {status.current.version}</span></label>
        <div className="form-actions"><button type="button" className="button button-quiet" onClick={() => setRecording(false)}>Cancel</button><button className="button button-primary" disabled={busy}>Record signature</button></div>
      </form> : <div><button type="button" className="button button-quiet" onClick={() => setRecording(true)}>Record a paper signature</button></div> : null}
      <p role="status" className="form-help">{message}</p>
    </div>
  </section>;
}
