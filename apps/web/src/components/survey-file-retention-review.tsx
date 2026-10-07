"use client";
import { useRef, useState } from "react";

type Register = { removals: { id: string; status: string; manifestVersion: string; createdAt: string; completedAt: string | null; reviewMessage: string | null; canCancel: boolean }[]; removalHistoryHasMore: boolean; analysisCount: number; adviserRecordCount: number; questionnaireDocuments: { id: string; name: string; supersededAt: string | null; analysisDisposed: boolean }[]; media: { id: string; filename: string | null; kind: string; derivation: string }[]; evidenceReferenceCount: number; externalEvidenceReferenceCount: number; hold: { revision: number; kind: string | null; reason: string } | null; reference: string; reportCount: number; deliveryCount: number; assessment: { reviewVersion: string; reason: string; retentionUntil: string | null; eligibleForManagerReview: boolean }; documents: { id: string; name: string; legalHold: boolean; archivedAt: string | null }[] };
const reasons: Record<string, string> = { evidence_review_required: "Evidence is shared, missing or inconsistent. Resolve its references before retention review.", policy_approval_required: "The practice policy needs approval in Operations settings.", protected: "A complaint, claim or legal hold protects this file.", job_open: "The job must be closed before retention review.", date_review_required: "Reliable final report delivery and closure dates are required.", retention_active: "The one-year retention period has not expired.", manager_review_required: "The retention period has expired. Review the file and any outstanding complaints or claims." };
export function SurveyFileRetentionReview({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  const [register, setRegister] = useState<Register | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewedVersion, setReviewedVersion] = useState<string | null>(null);
  const pendingRemoval = useRef<{ action: "request"; requestId: string; reviewVersion: string; reason: string; confirmed: boolean } | null>(null);
  const [message, setMessage] = useState("");
  async function load() {
    setBusy(true); setMessage(""); setRegister(null);
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/retention`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Retention assessment unavailable.");
      setRegister(payload.data); pendingRemoval.current = null;
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
      if (payload.data.persisted) setReviewedVersion(register.assessment.reviewVersion);
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
  async function requestRemoval(form: FormData) {
    if (!register || reviewedVersion !== register.assessment.reviewVersion) return;
    setBusy(true); setMessage("");
    const decision = pendingRemoval.current ?? { action: "request" as const, requestId: crypto.randomUUID(), reviewVersion: register.assessment.reviewVersion, reason: String(form.get("reason") ?? ""), confirmed: form.get("confirmed") === "on" };
    pendingRemoval.current = decision;
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/retention/removals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(decision) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Removal request failed.");
      pendingRemoval.current = null; setRegister(null); setReviewedVersion(null);
      setMessage(payload.data.persisted ? "Reviewed removal request recorded. Reload to view its status or cancel it before processing begins." : "Preview only. No removal was requested.");
    } catch (reason) { setMessage(`${reason instanceof Error ? reason.message : "Removal request failed."} Retry sends the same recorded decision; reload to review or change it.`); }
    finally { setBusy(false); }
  }
  async function cancelRemoval(id: string, manifestVersion: string, form: FormData) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/retention/removals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel", id, manifestVersion, reason: form.get("reason"), confirmed: form.get("confirmed") === "on" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Removal cancellation failed.");
      setRegister(null); setMessage(payload.data.persisted ? "Removal request cancelled. Reload the assessment to see the recorded outcome." : "Preview only. No request changed.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Removal cancellation failed."); }
    finally { setBusy(false); }
  }
  async function disposeAnalysis(id: string, manifestVersion: string, form: FormData) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/retention/removals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dispose_analysis", id, manifestVersion, documentId: form.get("documentId"), reason: form.get("reason"), confirmed: form.get("confirmed") === "on" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Analysis cleanup failed.");
      setRegister(null); setMessage(payload.data.persisted ? payload.data.duplicate ? "This questionnaire analysis was already removed." : "Questionnaire analysis removed. Original checksums and audit evidence are retained." : "Preview only. No analysis was removed.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Analysis cleanup failed."); }
    finally { setBusy(false); }
  }
  return <section className="panel"><div className="panel-header"><h2>Survey file retention review</h2></div><div className="panel-body">
    <p>The practice policy retains survey job files for one year from the later of final report delivery or job closure. Manager review is required after expiry.</p>
    <button className="button button-secondary" type="button" onClick={() => void load()} disabled={busy}>{busy ? "Working…" : "Load current file assessment"}</button>
    {register ? <><p>{reasons[register.assessment.reason] ?? "Review the current file protection."}</p><p>{register.reportCount} report versions · {register.deliveryCount} confirmed deliveries · {register.documents.length} registered originals · {register.media.length} survey media files · {register.questionnaireDocuments.length} questionnaire originals</p><p>{register.analysisCount} extracted analyses · {register.adviserRecordCount} adviser records · {register.evidenceReferenceCount} evidence links · {register.externalEvidenceReferenceCount} references from other files</p>
      {register.assessment.retentionUntil ? <p>Retain until {new Date(register.assessment.retentionUntil).toLocaleDateString("en-GB", { timeZone: "UTC" })}</p> : null}
      <ul>{register.documents.map(document => <li key={document.id}>{document.name}{document.legalHold ? " · legal hold" : ""}{document.archivedAt ? " · archived" : " · active"}</li>)}</ul>
      <ul>{register.media.map(media => <li key={media.id}>{media.filename ?? media.kind} · {media.derivation}</li>)}</ul>
      <ul>{register.questionnaireDocuments.map(document => <li key={document.id}>{document.name} · questionnaire original{document.analysisDisposed ? " · Analysis removed" : ""}{document.supersededAt ? " · superseded" : ""}</li>)}</ul>
      <p>{register.hold?.kind ? `Job hold: ${register.hold.kind}. ${register.hold.reason}` : "No active job-level hold recorded."}</p>
      {register.removals?.length ? <><h3>Original removal requests</h3><ul>{register.removals.map(removal => <li key={removal.id}>
        <p>{({ queued: "Awaiting processing", dispatched: "Processing originals", verification_required: "Outcome review required", completed: "Removal verified", cancelled: "Cancelled" } as Record<string, string>)[removal.status] ?? "Review required"} · requested {new Date(removal.createdAt).toLocaleDateString("en-GB")}</p>
        {removal.reviewMessage ? <p role="status">{removal.reviewMessage}</p> : null}
        {removal.canCancel && canEdit ? <details><summary>Cancel this request</summary><form action={form => cancelRemoval(removal.id, removal.manifestVersion, form)} className="form-grid">
          <label className="field"><span>Cancellation reason</span><textarea name="reason" minLength={10} maxLength={2000} required disabled={busy}/></label>
          <label><input type="checkbox" name="confirmed" required disabled={busy}/> I confirm this request should stop without removing any originals.</label>
          <button className="button button-secondary" disabled={busy}>Cancel removal request</button>
        </form></details> : null}
        {removal.status === "completed" && canEdit && register.assessment.eligibleForManagerReview && register.questionnaireDocuments.some(document => !document.analysisDisposed) ? <details><summary>Remove retained questionnaire analysis</summary><form action={form => disposeAnalysis(removal.id, removal.manifestVersion, form)} className="form-grid">
          <p>Remove the stored text extracted from a questionnaire original whose removal has been verified. The original checksum and cleanup audit remain recorded. This action cannot be undone.</p>
          <label className="field"><span>Questionnaire original</span><select name="documentId" required disabled={busy}>{register.questionnaireDocuments.filter(document => !document.analysisDisposed).map(document => <option key={document.id} value={document.id}>{document.name}</option>)}</select></label>
          <label className="field"><span>Cleanup reason</span><textarea name="reason" minLength={10} maxLength={2000} required disabled={busy}/></label>
          <label><input type="checkbox" name="confirmed" required disabled={busy}/> I confirm the retained analysis should be removed after reviewing this completed removal.</label>
          <button className="button button-secondary" disabled={busy}>Remove questionnaire analysis</button>
        </form></details> : null}
      </li>)}</ul>{register.removalHistoryHasMore ? <p>Showing the 20 most recent requests. Older decisions remain in the audit history.</p> : null}</> : null}
      {canEdit ? <details><summary>Review job hold</summary><form action={saveHold} className="form-grid">
        <label className="field"><span>Protection</span><select name="kind" defaultValue={register.hold?.kind ?? ""} disabled={busy}><option value="">No active hold / clear reviewed hold</option><option value="complaint">Unresolved complaint</option><option value="claim">Unresolved claim</option><option value="legal">Legal hold</option></select></label>
        <label className="field"><span>Reason and supporting evidence</span><textarea name="reason" minLength={10} maxLength={2000} required disabled={busy}/></label>
        <label><input type="checkbox" name="confirmed" required disabled={busy}/> I reviewed this protection decision, including any authority required to clear a hold.</label>
        <button className="button button-secondary" disabled={busy}>Save hold review</button>
      </form></details> : null}
      {canEdit && register.assessment.eligibleForManagerReview && reviewedVersion === register.assessment.reviewVersion && !register.removals?.some(removal => removal.status !== "cancelled") ? <details><summary>Request removal of reviewed originals</summary><form action={requestRemoval} className="form-grid">
        <p>This request covers the current reviewed originals. You can cancel it while it is awaiting processing.</p>
        <label className="field"><span>Reason for requesting removal</span><textarea name="reason" minLength={10} maxLength={2000} required disabled={busy}/></label>
        <label><input type="checkbox" name="confirmed" required disabled={busy}/> I confirm the reviewed originals can be permanently removed after the required checks.</label>
        <button className="button button-primary" disabled={busy}>Queue reviewed removal</button>
      </form></details> : null}
      {register.assessment.eligibleForManagerReview && canEdit ? <form action={review} className="form-grid">
        <label className="field"><span>Manager review evidence</span><textarea name="reason" minLength={10} maxLength={2000} required disabled={busy}/></label>
        <label><input type="checkbox" name="claimsChecked" required disabled={busy}/> I checked the practice complaint and claim records; no unresolved matter requires retention.</label>
        <label><input type="checkbox" name="confirmed" required disabled={busy}/> I reviewed this file and confirm the recorded assessment.</label>
        <button className="button button-primary" disabled={busy}>Record manager review</button>
      </form> : null}</> : null}<p role="status">{message}</p>
  </div></section>;
}
