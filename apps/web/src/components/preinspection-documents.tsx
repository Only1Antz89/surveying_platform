"use client";
import { useEffect, useRef, useState } from "react";
type Document = { originalRemovedAt: string | null; id: string; name: string; contentType: string; sizeBytes: number; checksum: string; supersededAt: string | null; createdAt: string; worksKind: string | null; analysis: { status?: string; reason?: string; facts?: { worksCompletionDate?: { value: string; span: { page: number; excerpt: string } } | null } } | null };
export function PreinspectionDocuments({ base, parentToken, scopedToken, canEdit, canAssociate = false }: { base: string; parentToken?: string; scopedToken: string; canEdit: boolean; canAssociate?: boolean }) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [replaceId, setReplaceId] = useState(""); const fileInput = useRef<HTMLInputElement>(null);
  const pendingRequestId = useRef<string | null>(null);
  const headers = (): Record<string, string> => parentToken ? { "x-quote-token": parentToken, "x-questionnaire-token": scopedToken } : {};
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base}/documents`, { headers: parentToken ? { "x-quote-token": parentToken, "x-questionnaire-token": scopedToken } : {}, signal: controller.signal }).then(async response => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "Documents could not be loaded."); setDocuments(payload.data); }).catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, [base, parentToken, scopedToken]);
  async function upload() {
    const file = fileInput.current?.files?.[0]; if (!file) { setMessage("Select a document first."); return; }
    setBusy(true); setMessage("");
    try {
      pendingRequestId.current ??= crypto.randomUUID();
      const form = new FormData(); form.set("file", file); form.set("requestId", pendingRequestId.current); if (replaceId) form.set("replacesId", replaceId);
      const response = await fetch(`${base}/documents`, { method: "POST", headers: headers(), body: form }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Upload failed.");
      const list = await fetch(`${base}/documents`, { headers: headers() }); const loaded = await list.json(); if (!list.ok) throw new Error("Document saved, but the list could not be refreshed. Reload this page.");
      setDocuments(loaded.data); setReplaceId(""); pendingRequestId.current = null; if (fileInput.current) fileInput.current.value = ""; setMessage("Private document saved. It is not a survey finding or proof of compliance.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed."); } finally { setBusy(false); }
  }
  async function download(document: Document) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${base}/documents/${document.id}`, { headers: headers() });
      if (!response.ok) { const payload = await response.json(); throw new Error(payload.error?.message ?? "Download failed."); }
      const url = URL.createObjectURL(await response.blob()); const link = window.document.createElement("a"); link.href = url; link.download = document.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Download failed."); } finally { setBusy(false); }
  }
  async function associate(document: Document) {
    const worksKind = window.prompt("Confirm which works this document belongs to: extension or conversion");
    if (!worksKind || !["extension", "conversion"].includes(worksKind)) return;
    const reason = window.prompt("Explain how you checked the original document, this property and these works (at least 10 characters).");
    if (!reason || reason.trim().length < 10) return;
    if (!window.confirm("I have reviewed the original and confirm the association with this property and the selected works. This does not certify legal compliance.")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${base}/documents/${document.id}/association`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ worksKind, reason, checksum: document.checksum, confirm: true }) }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Association could not be confirmed.");
      setMessage("Association audited. Load evidence in the survey to review the completion-year suggestion.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Association failed."); } finally { setBusy(false); }
  }
  return <section aria-label="Customer documents"><h3>Supporting documents</h3><p className="form-help">Private PDF, JPEG or PNG, up to 10 MB each. Include certificates, guarantees or alteration documents. Scanned files remain available for manual review. Replacements retain the original and audit history.</p>
    {message ? <p role="status">{message}</p> : null}
    {canEdit ? <div className="form-grid"><label className="form-field">Document<input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png" onChange={() => { pendingRequestId.current = null; }} disabled={busy}/></label><label className="form-field">Save as<select className="select" value={replaceId} onChange={event => { setReplaceId(event.target.value); pendingRequestId.current = null; }} disabled={busy}><option value="">New document</option>{documents.filter(item => !item.supersededAt && !item.originalRemovedAt).map(item => <option key={item.id} value={item.id}>Replace {item.name}</option>)}</select></label><button className="button button-secondary" type="button" disabled={busy} onClick={() => void upload()}>Upload private document</button></div> : null}
    <ul>{documents.map(item => <li key={item.id}><span>{item.name} · {Math.ceil(item.sizeBytes / 1024)} KB{item.originalRemovedAt ? " · Original removed after retention review" : item.supersededAt ? " · Replaced original" : ""}</span> <button className="button button-quiet" disabled={busy || Boolean(item.originalRemovedAt)} type="button" onClick={() => void download(item)}>Download</button>
      {item.analysis?.status === "unavailable" ? <p className="form-help">{item.analysis.reason}</p> : null}
      {item.analysis?.facts?.worksCompletionDate ? <p className="form-help">Document states works completed {item.analysis.facts.worksCompletionDate.value}, page {item.analysis.facts.worksCompletionDate.span.page}: “{item.analysis.facts.worksCompletionDate.span.excerpt}”. This is not an issue or permission date.</p> : null}
      {canAssociate && !parentToken && !item.supersededAt && item.analysis?.facts?.worksCompletionDate ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void associate(item)}>Review property/works association</button> : null}
    </li>)}</ul>
  </section>;
}
