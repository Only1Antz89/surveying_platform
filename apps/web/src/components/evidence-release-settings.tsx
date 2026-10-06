"use client";
import { useState } from "react";
export function EvidenceReleaseSettings({ initial, canEdit }: { initial: boolean; canEdit: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function change() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/operations/evidence", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "The flag could not be changed.");
      setEnabled(payload.data.enabled); setMessage("Demo evidence setting saved.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel"><div className="panel-body"><h2>Whole-form evidence pilot</h2><p>Private demo only. Customer questionnaires and optional template 1.2 upgrades remain separately reviewed; this does not grant professional recording permission or activate external providers.</p><p>Status: {enabled ? "Demo enabled" : "Disabled"}</p>{canEdit ? <button className="button button-secondary" disabled={busy} onClick={() => void change()}>{enabled ? "Disable demo evidence" : "Enable demo evidence"}</button> : null}{message ? <p role="status">{message}</p> : null}</div></section>;
}
