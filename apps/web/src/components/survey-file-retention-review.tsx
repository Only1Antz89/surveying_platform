"use client";
import { useState } from "react";

type Register = { analysisCount: number; adviserRecordCount: number; questionnaireDocuments: { id: string; name: string; supersededAt: string | null }[]; media: { id: string; filename: string | null; kind: string; derivation: string }[]; evidenceReferenceCount: number; externalEvidenceReferenceCount: number; hold: { revision: number; kind: string | null; reason: string } | null; reference: string; reportCount: number; deliveryCount: number; assessment: { reviewVersion: string; reason: string; retentionUntil: string | null; eligibleForManagerReview: boolean }; documents: { id: string; name: string; legalHold: boolean; archivedAt: string | null }[] };
const reasons: Record<string, string> = { evidence_review_required: "Evidence is shared, missing or inconsistent. Resolve its references before retention review.", policy_approval_required: "The practice policy needs approval in Operations settings.", protected: "A complaint, claim or legal hold protects this file.", job_open: "The job must be closed before retention review.", date_review_required: "Reliable final report delivery and closure dates are required.", retention_active: "The one-year retention period has not expired.", manager_review_required: "The retention period has expired. Review the file and any outstanding complaints or claims." };
export function SurveyFileRetentionReview({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  const [register, setRegister] = useState<Register | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load() {
    setBusy(true); setMessage(""); setRegister(null);
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/retention`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Retention assessment unavailable.");
      setRegister(payload.data);
      if (!payload.data) setMessage("No persistent retention file is available in this preview.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Retention assessment unavailable."); }
    finally { setBusy(false); }
  }
  async function review(form: FormData) {
    if (!register) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/retention`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewVersion: register.assessment.reviewVersion, reason: form.get("reason"), noUnresolvedComplaintOrClaim: form.get("claimsChecked") === "on", confirmed: form.get("confirmed") === "on" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "File review failed.");
      setMessage(payload.data.persisted ? "Manager file review recorded. No originals were removed; removal requires its separate workflow." : "Preview only. No file review was saved.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "File review failed."); }
    finally { setBusy(false); }
  }
  async function saveHold(form: FormData) {
    if (!register) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/retention`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: register.hold?.revision ?? 0, kind: form.get("kind") || null, reason: form.get("reason"), confirmed: form.get("confirmed") === "on" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Hold review failed.");
      setRegister(null);
      setMessage(payload.data.persisted ? "Job hold review saved. Reload the assessment. Document legal holds remain in place." : "Preview only. No job hold changed.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Hold review failed."); }
    finally { setBusy(false); }
  }
  return <section className="panel"><div className="panel-header"><h2>Survey file retention review</h2></div><div className="panel-body">
    <p>The practice policy retains survey job files for one year from the later of final report delivery or job closure. Manager review is required after expiry.</p>
    <button className="button button-secondary" type="button" onClick={() => void load()} disabled={busy}>{busy ? "Working…" : "Load current file assessment"}</button>
    {register ? <><p>{reasons[register.assessment.reason] ?? "Review the current file protection."}</p><p>{register.reportCount} report versions · {register.deliveryCount} confirmed deliveries · {register.documents.length} registered originals · {register.media.length} survey media files · {register.questionnaireDocuments.length} questionnaire originals</p><p>{register.analysisCount} extracted analyses · {register.adviserRecordCount} adviser records · {register.evidenceReferenceCount} evidence links · {register.externalEvidenceReferenceCount} references from other files</p>
      {register.assessment.retentionUntil ? <p>Retain until {new Date(register.assessment.retentionUntil).toLocaleDateString("en-GB", { timeZone: "UTC" })}</p> : null}
      <ul>{register.documents.map(document => <li key={document.id}>{document.name}{document.legalHold ? " · legal hold" : ""}{document.archivedAt ? " · archived" : " · active"}</li>)}</ul>
      <ul>{register.media.map(media => <li key={media.id}>{media.filename ?? media.kind} · {media.derivation}</li>)}</ul>
      <ul>{register.questionnaireDocuments.map(document => <li key={document.id}>{document.name} · questionnaire original{document.supersededAt ? " · superseded" : ""}</li>)}</ul>
      <p>{register.hold?.kind ? `Job hold: ${register.hold.kind}. ${register.hold.reason}` : "No active job-level hold recorded."}</p>
      {canEdit ? <details><summary>Review job hold</summary><form action={saveHold} className="form-grid">
        <label className="field"><span>Protection</span><select name="kind" defaultValue={register.hold?.kind ?? ""} disabled={busy}><option value="">No active hold / clear reviewed hold</option><option value="complaint">Unresolved complaint</option><option value="claim">Unresolved claim</option><option value="legal">Legal hold</option></select></label>
        <label className="field"><span>Reason and supporting evidence</span><textarea name="reason" minLength={10} maxLength={2000} required disabled={busy}/></label>
        <label><input type="checkbox" name="confirmed" required disabled={busy}/> I reviewed this protection decision, including any authority required to clear a hold.</label>
        <button className="button button-secondary" disabled={busy}>Save hold review</button>
      </form></details> : null}
      {register.assessment.eligibleForManagerReview && canEdit ? <form action={review} className="form-grid">
        <label className="field"><span>Manager review evidence</span><textarea name="reason" minLength={10} maxLength={2000} required disabled={busy}/></label>
        <label><input type="checkbox" name="claimsChecked" required disabled={busy}/> I checked the practice complaint and claim records; no unresolved matter requires retention.</label>
        <label><input type="checkbox" name="confirmed" required disabled={busy}/> I reviewed this file and confirm the recorded assessment.</label>
        <button className="button button-primary" disabled={busy}>Record manager review</button>
      </form> : null}</> : null}<p role="status">{message}</p>
  </div></section>;
}
