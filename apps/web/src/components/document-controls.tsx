"use client";
import {workspaceFetch} from "@/lib/workspace-request";
import { useState } from "react";
import { DocumentUploader } from "./document-uploader";
import { useRouter } from "next/navigation";

export function DocumentControls({ id, category, accessClass, checksum, retentionUntil, legalHold }: { id: string; category: string; accessClass: string; checksum:string; retentionUntil: string | null; legalHold: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(form: FormData) {
    setBusy(true); setMessage("");
    try {
      const date = String(form.get("retentionUntil") ?? "");
      const response = await workspaceFetch(`/api/v1/documents/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ category: form.get("category"), accessClass: form.get("accessClass"), retentionUntil: date ? new Date(`${date}T12:00:00Z`).toISOString() : null, legalHold: form.get("legalHold") === "on" }) });
      const payload = await response.json();
      setMessage(response.ok ? "Protection updated." : payload.error?.message ?? "Changes could not be saved.");
      if (response.ok) router.refresh();
    } catch { setMessage("Connection lost. Your changes have not been saved."); }
    finally { setBusy(false); }
  }
  async function archive() {
    if (!confirm("Archive this document? Documents under legal hold cannot be archived.")) return;
    setBusy(true);
    try { const response = await workspaceFetch(`/api/v1/documents/${id}`, { method: "DELETE" }); if (response.ok) { setMessage("Document archived."); router.refresh(); } else { const payload = await response.json(); setMessage(payload.error?.message ?? "Archive failed."); } }
    catch { setMessage("Connection lost. The document has not been archived."); }
    finally { setBusy(false); }
  }
  return <details><summary>Manage protection</summary><form action={save} className="form-grid"><label className="field"><span>Category</span><input name="category" defaultValue={category} maxLength={80} required /></label><label className="field"><span>Who can access</span><select name="accessClass" defaultValue={accessClass}><option value="restricted">Owners and administrators</option><option value="firm">All practice members</option><option value="job">Assigned job surveyor and administrators</option></select></label><label className="field"><span>Retain until</span><input name="retentionUntil" type="date" defaultValue={retentionUntil?.slice(0, 10)} /></label><label><input name="legalHold" type="checkbox" defaultChecked={legalHold} /> Legal hold</label><button className="button button-secondary" disabled={busy}>Save protection</button><button type="button" className="button button-secondary" disabled={busy || legalHold} onClick={() => void archive()}>Archive document</button><p role="status">{message}</p></form>{!legalHold?<details><summary>Replace while retaining the original</summary><DocumentUploader replaceId={id} expectedChecksum={checksum}/></details>:null}</details>;
}
