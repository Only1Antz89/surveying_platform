"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { serviceLevelLabels, serviceLevels } from "@surveynt/assistant";
import { ukCountries, ukCountryLabels } from "@surveynt/domain";
import { offlineStore, setOfflineScope } from "@/lib/offline-store";
import { SurveyWorkspace } from "./survey-workspace";

/** Resolves (or starts) the survey for a job. Works offline for surveys already opened on this device. */
export function SurveyEntry({ slug, jobId, offlineScope, canEdit, canJudge }: { slug: string; jobId: string; offlineScope: string; canEdit: boolean; canJudge: boolean }) {
  setOfflineScope(offlineScope);
  const [surveyId, setSurveyId] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    (async () => {
      await offlineStore.expireStalePacks().catch(() => 0);
      try {
        const response = await fetch(`/api/v1/jobs/${jobId}/survey`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message ?? "The survey could not be opened.");
        if (payload.data.surveyId) await offlineStore.rememberSurveyForJob(jobId, payload.data.surveyId);
        setSurveyId(payload.data.surveyId);
      } catch (reason) {
        const remembered = await offlineStore.surveyForJob(jobId);
        if (remembered) setSurveyId(remembered);
        else { setSurveyId(null); setError(reason instanceof Error && navigator.onLine ? reason.message : "You are offline and this survey has not been opened on this device yet."); }
      }
    })();
  }, [jobId]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStarting(true); setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/v1/jobs/${jobId}/survey`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceLevel: form.get("serviceLevel"), jurisdiction: form.get("jurisdiction") || undefined }) });
    const payload = await response.json(); setStarting(false);
    if (!response.ok) return setError(payload?.error?.message ?? "The survey could not be started.");
    await offlineStore.rememberSurveyForJob(jobId, payload.data.surveyId);
    setSurveyId(payload.data.surveyId);
  }

  return <>
    <div className="workspace-back"><Link href={`/app/${slug}/jobs`} className="button button-quiet"><ArrowLeft size={14} />All jobs</Link></div>
    {surveyId ? <SurveyWorkspace surveyId={surveyId} canEdit={canEdit} canJudge={canJudge} /> : surveyId === undefined ? <section className="panel"><div className="empty-state"><strong>Opening survey…</strong></div></section> : <section className="panel">
      <div className="panel-header"><div><h2>Start the survey</h2><p>Choose the agreed service scope. The form template and its version are pinned to this survey.</p></div><ClipboardList size={17} color="#3b82f6" aria-hidden="true" /></div>
      {canEdit && !error?.startsWith("You are offline") ? <form className="form-section" onSubmit={start}><div className="form-grid">
        <div className="field"><label htmlFor="survey-scope">Service scope</label><select id="survey-scope" name="serviceLevel" className="select" required defaultValue="">{[<option key="" value="" disabled>Select scope</option>, ...serviceLevels.map((level) => <option key={level} value={level}>{serviceLevelLabels[level]}</option>)]}</select></div>
        <div className="field"><label htmlFor="survey-jurisdiction">Jurisdiction</label><select id="survey-jurisdiction" name="jurisdiction" className="select" defaultValue=""><option value="">Use the property&apos;s country</option>{ukCountries.map((country) => <option key={country} value={country}>{ukCountryLabels[country]}</option>)}</select></div>
        <div className="form-actions full"><button className="button button-primary" disabled={starting}>{starting ? "Starting…" : "Start survey"}</button></div>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}</form> : <div className="empty-state">{error ? <strong>{error}</strong> : <strong>No survey has been started for this job.</strong>}</div>}
    </section>}
  </>;
}
