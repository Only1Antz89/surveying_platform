"use client";
import {workspaceFetch} from "@/lib/workspace-request";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ArchivedDocument = { removalReview:{attempts:number;leaseToken:string|null}|null; purgeStatus:string; jobId:string|null; reportVersionId:string|null; purgedAt:string|null; id: string; name: string; checksum: string; archivedAt: string; updatedAt:string; retentionUntil: string | null; legalHold: boolean };

function localDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DocumentArchive() {
  const router = useRouter();
  const [rows, setRows] = useState<ArchivedDocument[] | null>(null);
  const [reviewing,setReviewing]=useState<ArchivedDocument|null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load() {
    setBusy(true); setMessage("");
    try {
      const response = await workspaceFetch("/api/v1/documents?archived=true", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "The archive could not be loaded.");
      setRows(payload.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The archive request failed."); }
    finally { setBusy(false); }
  }
  async function restore(document: ArchivedDocument) {
    if (!confirm(`Restore ${document.name} to the document register?`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await workspaceFetch(`/api/v1/documents/${document.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "restore", expectedChecksum: document.checksum }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "The document could not be restored.");
      setRows(current => current?.filter(row => row.id !== document.id) ?? null);
      setMessage("Retained original restored. Protection and retention are unchanged.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The recovery request failed."); }
    finally { setBusy(false); }
  }
  async function removal(document:ArchivedDocument,cancel=false){
    const reason=prompt(cancel?"Reason for cancelling this pending removal":"Reason for permanently removing this expired original");
    if(!reason)return;
    if(reason.trim().length<10){setMessage("Record a reason of at least 10 characters.");return;}
    if(!confirm(cancel?`Cancel the pending removal of ${document.name}? Cancellation is possible only before deletion starts.`:`Permanently remove ${document.name}? The stored original cannot be restored after deletion. Audit metadata will remain.`))return;
    setBusy(true);setMessage("");
    try{
      const response=await workspaceFetch(`/api/v1/documents/${document.id}/removal`,{method:cancel?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expectedChecksum:document.checksum,expectedUpdatedAt:document.updatedAt,reason,confirmed:true})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??"Removal request failed.");
      await load();setMessage(cancel?"Removal cancelled; the original remains archived.":"Removal requested. Refresh the archive to check the worker result.");router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Removal request failed.");}finally{setBusy(false);}
  }
  async function resolveRemoval(document:ArchivedDocument,outcome:"keep_original"|"confirm_absent"){
    if(!document.removalReview)return;
    const evidence=prompt("Record the provider evidence confirming all deletion operations have finished and the original's current storage state.");if(!evidence)return;
    if(!confirm("Confirm you checked provider evidence and all storage operations have settled. The server will verify the original's presence or absence before saving this review."))return;
    setBusy(true);setMessage("");
    try{
      const response=await workspaceFetch(`/api/v1/documents/${document.id}/removal-review`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({outcome,expectedChecksum:document.checksum,expectedUpdatedAt:document.updatedAt,expectedAttempts:document.removalReview.attempts,expectedLeaseToken:document.removalReview.leaseToken,evidence,providerOperationsSettled:true,confirmed:true})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??"Storage review failed.");
      await load();setMessage(outcome==="keep_original"?"Verified original retained in the archive.":"Original absence verified and review recorded.");router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Storage review failed.");}finally{setBusy(false);}
  }
  async function saveReview(form:FormData){
    if(!reviewing)return;setBusy(true);setMessage("");
    try{
      const date=String(form.get("retentionUntil")??"");
      const response=await workspaceFetch(`/api/v1/documents/${reviewing.id}/retention`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({expectedChecksum:reviewing.checksum,expectedUpdatedAt:reviewing.updatedAt,expectedLegalHold:reviewing.legalHold,expectedRetentionUntil:reviewing.retentionUntil,retentionUntil:date?new Date(date).toISOString():null,legalHold:form.get("legalHold")==="on",reason:form.get("reason"),confirmed:form.get("confirmed")==="on"})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??"Retention review failed.");
      setRows(current=>current?.map(row=>row.id===reviewing.id?{...row,...payload.data}:row)??null);setReviewing(null);setMessage("Retention review recorded. The original remains stored.");router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Retention review failed.");}finally{setBusy(false);}
  }
  const isSuccess = message.includes("restored") || message.includes("recorded") || message.includes("retained") || message.includes("requested");

  return (
    <details className="panel-body accordion-card" style={{ margin: "16px 20px" }}>
      <summary className="accordion-summary">
        <span>Archived documents and retention</span>
      </summary>
      <div style={{ paddingTop: "14px" }}>
        <div className="flex items-center justify-between gap-4" style={{ marginBottom: "14px" }}>
          <p className="cell-sub" style={{ margin: 0, lineHeight: 1.5 }}>
            Archived originals remain stored. Expiry of a retention date does not automatically delete a file.
          </p>
          <button className="button button-secondary" disabled={busy} onClick={() => void load()}>
            {busy ? "Loading…" : "Review archive"}
          </button>
        </div>

        {rows ? (
          rows.length ? (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Archived</th>
                    <th>Protection</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      <td>{new Date(row.archivedAt).toLocaleDateString("en-GB")}</td>
                      <td>
                        {row.legalHold ? (
                          <span className="status status-red">Legal hold</span>
                        ) : row.retentionUntil ? (
                          `Retain until ${new Date(row.retentionUntil).toLocaleDateString("en-GB")}`
                        ) : (
                          "No retention date"
                        )}
                      </td>
                      <td>
                        {row.purgeStatus === "purged" ? (
                          <span className="status status-slate">Purged</span>
                        ) : row.purgeStatus === "verification_required" ? (
                          <span className="status status-red">Verification required</span>
                        ) : row.purgeStatus === "removing" ? (
                          <span className="status status-amber">Removing</span>
                        ) : row.purgeStatus === "pending" ? (
                          <span className="status status-amber">Pending removal</span>
                        ) : (
                          <span className="status status-blue">Retained</span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          {row.purgeStatus === "retained" ? (
                            <>
                              <button className="button button-quiet" disabled={busy} onClick={() => setReviewing(row)}>
                                Review retention
                              </button>
                              <button className="button button-secondary" disabled={busy} onClick={() => void restore(row)}>
                                Restore original
                              </button>
                              {!row.legalHold &&
                              row.retentionUntil &&
                              new Date(row.retentionUntil) <= new Date() &&
                              !row.jobId &&
                              !row.reportVersionId ? (
                                <button className="button button-quiet danger" disabled={busy} onClick={() => void removal(row)}>
                                  Request permanent removal
                                </button>
                              ) : null}
                            </>
                          ) : row.purgeStatus === "pending" ? (
                            <button className="button button-secondary" disabled={busy} onClick={() => void removal(row, true)}>
                              Cancel removal
                            </button>
                          ) : row.purgeStatus === "verification_required" && row.removalReview ? (
                            <>
                              <button
                                className="button button-secondary"
                                disabled={busy}
                                onClick={() => void resolveRemoval(row, "keep_original")}
                              >
                                Verify & keep original
                              </button>
                              <button
                                className="button button-quiet"
                                disabled={busy}
                                onClick={() => void resolveRemoval(row, "confirm_absent")}
                              >
                                Confirm original absent
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="cell-sub" style={{ margin: "14px 0" }}>No archived documents found in this workspace.</p>
          )
        ) : null}

        {reviewing ? (
          <div
            style={{
              marginTop: "20px",
              padding: "18px",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              background: "var(--surface-2)",
            }}
          >
            <form action={saveReview} key={reviewing.id}>
              <h3 style={{ margin: "0 0 14px", fontSize: "1rem" }}>Review retention: {reviewing.name}</h3>
              <div className="form-grid">
                <label className="field">
                  <span>Retain until (device timezone; blank means no expiry)</span>
                  <input
                    name="retentionUntil"
                    type="datetime-local"
                    defaultValue={localDate(reviewing.retentionUntil)}
                  />
                </label>
                <div className="field flex items-center">
                  <label className="checkbox-row" style={{ marginTop: "24px" }}>
                    <input name="legalHold" type="checkbox" defaultChecked={reviewing.legalHold} />
                    <span>Apply legal hold</span>
                  </label>
                </div>
                <label className="field full">
                  <span>Reason for this review</span>
                  <textarea name="reason" minLength={10} maxLength={2000} rows={3} required placeholder="Audit reason..." />
                </label>
                <div className="field full">
                  <label className="checkbox-row">
                    <input name="confirmed" type="checkbox" required />
                    <span>I reviewed this document and confirm these protection changes.</span>
                  </label>
                </div>
              </div>
              <div className="action-row" style={{ marginTop: "14px" }}>
                <button className="button button-primary" disabled={busy}>
                  Record review
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={busy}
                  onClick={() => setReviewing(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {message ? (
          <p className={isSuccess ? "form-success" : "form-error"} role="status" style={{ marginTop: "12px" }}>
            <span>{message}</span>
          </p>
        ) : null}
      </div>
    </details>
  );
}
