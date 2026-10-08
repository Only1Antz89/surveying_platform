"use client";
import {workspaceFetch} from "@/lib/workspace-request";
import {useUnsavedChanges} from "./unsaved-changes";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SurveyRetentionSettings({ initial, canEdit }: { initial: { revision: number; enabled: boolean; version: string; approvedAt: string } | null; canEdit: boolean }) {
  const router = useRouter();
  const [dirty,setDirty]=useState(false);useUnsavedChanges(dirty);
  const [policy, setPolicy] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(form: FormData) {
    setBusy(true); setMessage("");
    try {
      const response = await workspaceFetch("/api/v1/operations/retention-policy", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: policy?.revision ?? 0, policyVersion: "survey-file-1-year-v2", enabled: form.get("enabled") === "on", reason: form.get("reason"), confirmed: form.get("confirmed") === "on" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Policy review failed.");
      if (payload.data.persisted) { setPolicy(payload.data.policy);setDirty(false); setMessage("Practice policy review saved. File removal still requires a separate manager review."); router.refresh(); }
      else setMessage("Preview only. No practice policy was changed.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Policy review failed."); }
    finally { setBusy(false); }
  }
  return <section className="panel"><div className="panel-header"><h2>Survey file retention</h2></div><form onChange={()=>setDirty(true)} action={save} className="panel-body form-grid">
    <p>Retain survey job files for one year from the later of final report delivery or job closure. Expiry requires manager review. Complaints, claims and legal holds block removal.</p>
    <p>This policy applies to survey job/report originals. Ordinary upload retention is configured separately. No automatic deletion is enabled.</p>
    <p>{policy?.enabled ? `Practice policy enabled, revision ${policy.revision}.` : "Practice policy not enabled."}</p>
    <label><input type="checkbox" name="enabled" defaultChecked={policy?.enabled ?? false} disabled={!canEdit || busy}/> Enable the one-year survey file policy</label>
    <label className="field"><span>Review reason</span><textarea name="reason" minLength={10} maxLength={2000} required disabled={!canEdit || busy}/></label>
    <label><input type="checkbox" name="confirmed" required disabled={!canEdit || busy}/> I confirm this practice policy decision.</label>
    <button className="button button-primary" disabled={!canEdit || busy}>{busy ? "Saving…" : "Save policy review"}</button><p role="status">{message}</p>
  </form></section>;
}
