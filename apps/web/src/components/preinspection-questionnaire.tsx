"use client";
import { useCallback, useEffect, useState } from "react";
import { preinspectionQuestionLabels, type PreinspectionAnswers } from "@surveynt/assistant";
import { PreinspectionDocuments } from "./preinspection-documents";

type View = { draft: { version: number; answers: PreinspectionAnswers }; submission: { version: number; createdAt: string } | null; history: { id: string; version: number; createdAt: string; source: string }[]; valuation: boolean };
export function PreinspectionQuestionnaire({ quoteId, token, jobId, canEdit = true, canAssociate = false }: { quoteId?: string; token?: string; jobId?: string; canEdit?: boolean; canAssociate?: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [answers, setAnswers] = useState<PreinspectionAnswers>({});
  const [scopeToken, setScopeToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const base = jobId ? `/api/v1/jobs/${jobId}/questionnaire` : `/api/v1/public/quotes/${quoteId}/questionnaire`;
  const request = useCallback(async (path: string, init?: RequestInit, scoped?: string) => {
    const response = await fetch(path, { ...init, cache: "no-store", headers: { "content-type": "application/json", ...(token ? { "x-quote-token": token, "x-questionnaire-token": scoped ?? scopeToken } : {}), ...init?.headers } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "The questionnaire is unavailable.");
    return payload.data;
  }, [scopeToken, token]);
  useEffect(() => {
    let current = true;
    const load = async () => {
      try {
        let scoped = "";
        if (!jobId) {
          const response = await fetch(`${base}/access`, { method: "POST", headers: { "x-quote-token": token ?? "" } });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error?.message ?? "Your questionnaire link is unavailable.");
          scoped = payload.data.token;
        }
        const response = await fetch(base, { cache: "no-store", headers: { "x-quote-token": token ?? "", "x-questionnaire-token": scoped } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "The questionnaire is unavailable.");
        if (current) { setScopeToken(scoped); setView(payload.data); setAnswers(payload.data.draft.answers); }
      } catch (error) { if (current) { setMessage((error as Error).message); setFailed(true); } }
    };
    void load();
    return () => { current = false; };
  }, [base, jobId, token]);
  async function save(submit: boolean) {
    if (!view) return;
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const result = await request(base, { method: submit ? "POST" : "PATCH", body: JSON.stringify({ version: view.draft.version, requestId: crypto.randomUUID(), answers }) });
      setView(result); setAnswers(result.draft.answers); setMessage(submit ? "Submitted. These remain customer statements for the surveyor to review." : "Draft saved. It has not been supplied as survey evidence.");
    } catch (error) { setMessage((error as Error).message); setFailed(true); }
    finally { setBusy(false); }
  }
  return <section className="panel"><div className="panel-header"><div><h2>Before the inspection</h2><p>Optional customer information. Leave anything unknown blank. These answers never replace inspection findings.</p></div></div><div className="panel-body">
    {message ? <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "form-success"}>{message}</p> : null}
    {!view ? !message ? <p role="status">Loading questionnaire…</p> : null : <><p className="form-help">{view.submission ? `Last submitted version ${view.submission.version}. Corrections create a new version; earlier submissions are retained.` : "Not submitted. Saved drafts are not survey evidence."} {jobId ? "Staff entries are labelled as transcribed customer statements." : ""}</p>
      <form onSubmit={event => { event.preventDefault(); void save(true); }} className="form-grid">
        {(Object.entries(preinspectionQuestionLabels) as [keyof PreinspectionAnswers, string][]).filter(([key]) => key !== "agreedPurchasePriceMinor" || view.valuation).map(([key, label]) => <label className="form-field" key={key}>{label}{/Year|Minor$/.test(key) ? <input className="input" type="number" min={key.endsWith("Year") ? 1700 : 0} max={key.endsWith("Year") ? 2200 : 2_000_000_000} step={1} value={answers[key] ?? ""} disabled={!canEdit || busy} onChange={event => setAnswers(current => ({ ...current, [key]: event.target.value === "" ? undefined : Number(event.target.value) }))} /> : <textarea className="input" maxLength={2000} rows={2} value={answers[key] ?? ""} disabled={!canEdit || busy} onChange={event => setAnswers(current => ({ ...current, [key]: event.target.value }))} />}</label>)}
        {canEdit ? <div className="row-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => void save(false)}>Save draft</button><button type="submit" className="button button-primary" disabled={busy}>{view.submission ? "Submit correction" : "Submit information"}</button></div> : null}
      </form>
      <PreinspectionDocuments base={base} parentToken={token} scopedToken={scopeToken} canEdit={canEdit} canAssociate={canAssociate} />
      {view.history.length ? <details><summary>Submitted version history</summary><ul>{view.history.map(item => <li key={item.id}>Version {item.version} · {new Date(item.createdAt).toLocaleString("en-GB")} · {item.source === "customer" ? "Customer statement" : "Staff-transcribed customer statement"}</li>)}</ul></details> : null}
    </>}
  </div></section>;
}
