"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ArchivedDocument = { removalReview:{attempts:number;leaseToken:string|null}|null; purgeStatus:string; jobId:string|null; reportVersionId:string|null; purgedAt:string|null; id: string; name: string; checksum: string; archivedAt: string; updatedAt:string; retentionUntil: string | null; legalHold: boolean };

export function DocumentArchive() {
  const router = useRouter();
  const [rows, setRows] = useState<ArchivedDocument[] | null>(null);
  const [reviewing,setReviewing]=useState<ArchivedDocument|null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/documents?archived=true", { cache: "no-store" });
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
      const response = await fetch(`/api/v1/documents/${document.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "restore", expectedChecksum: document.checksum }) });
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
      const response=await fetch(`/api/v1/documents/${document.id}/removal`,{method:cancel?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expectedChecksum:document.checksum,expectedUpdatedAt:document.updatedAt,reason,confirmed:true})});
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
      const response=await fetch(`/api/v1/documents/${document.id}/removal-review`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({outcome,expectedChecksum:document.checksum,expectedUpdatedAt:document.updatedAt,expectedAttempts:document.removalReview.attempts,expectedLeaseToken:document.removalReview.leaseToken,evidence,providerOperationsSettled:true,confirmed:true})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??"Storage review failed.");
      await load();setMessage(outcome==="keep_original"?"Verified original retained in the archive.":"Original absence verified and review recorded.");router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Storage review failed.");}finally{setBusy(false);}
  }
  async function saveReview(form:FormData){
    if(!reviewing)return;setBusy(true);setMessage("");
    try{
      const date=String(form.get("retentionUntil")??"");
      const response=await fetch(`/api/v1/documents/${reviewing.id}/retention`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({expectedChecksum:reviewing.checksum,expectedUpdatedAt:reviewing.updatedAt,expectedLegalHold:reviewing.legalHold,expectedRetentionUntil:reviewing.retentionUntil,retentionUntil:date?new Date(date).toISOString():null,legalHold:form.get("legalHold")==="on",reason:form.get("reason"),confirmed:form.get("confirmed")==="on"})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??"Retention review failed.");
      setRows(current=>current?.map(row=>row.id===reviewing.id?{...row,...payload.data}:row)??null);setReviewing(null);setMessage("Retention review recorded. The original remains stored.");router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Retention review failed.");}finally{setBusy(false);}
  }
  const localDate=(value:string|null)=>{if(!value)return "";const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);};
  return <details className="panel-body"><summary>Archived documents and retention</summary><p>Archived originals remain stored. Expiry of a retention date does not automatically delete a file.</p><button className="button button-secondary" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Review archive"}</button>{rows ? rows.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Document</th><th>Archived</th><th>Protection</th><th>Recovery</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.name}</td><td>{new Date(row.archivedAt).toLocaleDateString("en-GB")}</td><td>{row.legalHold ? "Legal hold" : row.retentionUntil ? `Retain until ${new Date(row.retentionUntil).toLocaleDateString("en-GB")}` : "No retention date"}</td><td><p>{row.purgeStatus==="purged"?"Original permanently removed":row.purgeStatus==="verification_required"?"Storage verification required":row.purgeStatus==="removing"?"Removal started":row.purgeStatus==="pending"?"Removal pending":"Original retained"}</p>{row.purgeStatus==="retained"?<><button className="button button-quiet" disabled={busy} onClick={()=>setReviewing(row)}>Review retention</button><button className="button button-secondary" disabled={busy} onClick={() => void restore(row)}>Restore original</button>{!row.legalHold&&row.retentionUntil&&new Date(row.retentionUntil)<=new Date()&&!row.jobId&&!row.reportVersionId?<button className="button button-quiet" disabled={busy} onClick={()=>void removal(row)}>Request permanent removal</button>:null}</>:row.purgeStatus==="pending"?<button className="button button-secondary" disabled={busy} onClick={()=>void removal(row,true)}>Cancel removal</button>:row.purgeStatus==="verification_required"&&row.removalReview?<><button className="button button-secondary" disabled={busy} onClick={()=>void resolveRemoval(row,"keep_original")}>Verify and keep original</button><button className="button button-quiet" disabled={busy} onClick={()=>void resolveRemoval(row,"confirm_absent")}>Confirm original absent</button></>:null}</td></tr>)}</tbody></table></div> : <p>No archived documents.</p> : null}{reviewing?<form action={saveReview} key={reviewing.id}><h3>Review retention: {reviewing.name}</h3><label className="field"><span>Retain until (device timezone; blank means no expiry)</span><input name="retentionUntil" type="datetime-local" defaultValue={localDate(reviewing.retentionUntil)}/></label><label><input name="legalHold" type="checkbox" defaultChecked={reviewing.legalHold}/> Legal hold</label><label className="field"><span>Reason for this review</span><textarea name="reason" minLength={10} maxLength={2000} required/></label><label><input name="confirmed" type="checkbox" required/> I reviewed this document and confirm these protection changes.</label><div className="action-row"><button className="button button-primary" disabled={busy}>Record review</button><button type="button" className="button button-quiet" disabled={busy} onClick={()=>setReviewing(null)}>Cancel</button></div></form>:null}<p role="status">{message}</p></details>;
}
