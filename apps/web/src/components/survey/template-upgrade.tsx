"use client";
import { useEffect, useState } from "react";
import type { SurveyPack } from "@/lib/surveys";

export function TemplateUpgrade({ pack, disabled, onChanged }: { pack: SurveyPack; disabled: boolean; onChanged: () => Promise<void> }) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let current = true;
    fetch(`/api/v1/jobs/${pack.survey.jobId}/survey`, { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(payload => { if (current) setAvailable(payload?.data?.wholeFormEnabled === true); }).catch(() => undefined);
    return () => { current = false; };
  }, [pack.survey.jobId]);
  if (!available || !["1.0.0", "1.1.0"].includes(pack.survey.templateVersion) || !pack.survey.templateKey.startsWith("surveynt-home-survey-")) return null;
  async function upgrade() {
    if (!window.confirm("Upgrade this open survey to evidence mappings 1.2? Recorded answers, observations and photos stay unchanged. Pending suggestions will be superseded. Sync all device changes first.")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/surveys/${pack.survey.id}/template`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: pack.survey.version, confirm: true }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "The upgrade could not be completed.");
      await onChanged(); setMessage("Template upgraded. Load evidence to create fresh suggestions.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel"><div className="panel-body"><h2>Expanded evidence mappings</h2><p>Optional, audited upgrade to version 1.2. Your existing answers and form presentation are preserved.</p><button className="button button-secondary" disabled={disabled || busy} onClick={() => void upgrade()}>Upgrade this survey</button>{message ? <p role="status">{message}</p> : null}</div></section>;
}
