"use client";

import { type FormEvent, useState } from "react";
import { BookOpen } from "lucide-react";
import type { SurveyPack } from "@/lib/surveys";

type SharedCase = {
  id: string; reference: string; elementLabel: string; jurisdiction: string; propertyType: string | null; ageBand: string | null; observedFeature: string; possibleCauses: string[];
  confirmedCause: string | null; surveyorJudgement: string; ratingExample: string | null; nextSteps: string[]; limitations: string | null; uncertainty: string; ratingDisagreement: boolean; noDefect: boolean;
};
type Result = { available: boolean; reason: string | null; notice: string; release: { version: string; unsupportedSegments: string[] } | null; cases: SharedCase[] };

/**
 * Reviewed, generalised examples from the shared release, for the surveyor to
 * consult. They never fill a field and never describe this property.
 */
export function SharedCasesPanel({ pack, sectionKey, online }: { pack: SurveyPack; sectionKey: string; online: boolean }) {
  const elements = pack.template.sections.flatMap((section) => section.elements.filter((element) => element.inspectable).map((element) => ({ key: `${section.key}.${element.key}`, label: `${section.label}: ${element.label}`, sectionKey: section.key })));
  const [element, setElement] = useState<string>("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});

  async function sendFeedback(id: string, rating: "helpful" | "not_helpful" | "incorrect" | "identifying", note?: string) {
    const response = await fetch(`/api/v1/shared-cases/${id}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating, note: note ?? null }) });
    const payload = await response.json().catch(() => null);
    const message = !response.ok ? payload?.error?.message ?? "Feedback could not be sent." : payload?.data?.suspended ? "Thank you. The example has been withdrawn from use while it is reviewed." : "Thank you. Feedback goes to reviewers and is never used for training.";
    setFeedback((current) => ({ ...current, [id]: message }));
  }
  const selected = element || elements.find((item) => item.sectionKey === sectionKey)?.key || elements[0]?.key || "";

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams({ element: String(form.get("element") ?? ""), q: String(form.get("q") ?? "").trim() });
    if (pack.survey.jurisdiction) params.set("jurisdiction", pack.survey.jurisdiction);
    setBusy(true); setError(null);
    const response = await fetch(`/api/v1/shared-cases?${params}`, { cache: "no-store" });
    setBusy(false);
    if (!response.ok) { setError("Reviewed examples could not be loaded."); return; }
    setResult((await response.json()).data);
  }

  return <section className="panel shared-cases-panel" aria-labelledby="shared-cases-heading">
    <div className="panel-header"><div><h2 id="shared-cases-heading">Reviewed examples</h2><p>Generalised cases reviewed by surveyors, the same for every firm. For reference only.</p></div><BookOpen size={17} color="#3b82f6" aria-hidden="true" /></div>
    <form className="form-section" onSubmit={(event) => void search(event)}>
      <div className="field"><label htmlFor="shared-element">Element</label><select id="shared-element" name="element" className="select" value={selected} onChange={(event) => setElement(event.target.value)}>{elements.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></div>
      <div className="field"><label htmlFor="shared-words">Words (optional)</label><input id="shared-words" name="q" className="input" maxLength={200} placeholder="For example: slipped slates" /></div>
      <div className="form-actions"><button className="button button-secondary" disabled={busy || !online}>{busy ? "Searching…" : "Find examples"}</button></div>
    </form>
    {!online ? <p className="form-help assistant-empty">Available when online.</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {result ? <div className="shared-cases-result">
      {!result.available || !result.release ? <p className="form-help assistant-empty">{result.reason ?? "No reviewed examples are available."}</p> : <>
        <p className="form-help">{result.notice} Release {result.release.version}.</p>
        {result.cases.length ? <ul className="ai-list">{result.cases.map((item) => <li key={item.id}>
          <strong>{item.observedFeature}</strong>
          <span className="cell-sub">{[item.jurisdiction, item.propertyType, item.ageBand?.replace("_", "–"), item.ratingExample ? `example rating ${item.ratingExample}` : null, `${item.uncertainty} uncertainty`].filter(Boolean).join(" · ")}{item.ratingDisagreement ? " · reviewers disagreed on the rating" : ""}</span>
          <span className="cell-sub">Judgement: {item.surveyorJudgement}</span>
          {item.possibleCauses.length ? <span className="cell-sub">Possible causes (not confirmed): {item.possibleCauses.join("; ")}</span> : null}
          {item.confirmedCause ? <span className="cell-sub">Confirmed by follow-up: {item.confirmedCause}</span> : null}
          {item.nextSteps.length ? <span className="cell-sub">Next steps in that case: {item.nextSteps.join("; ")}</span> : null}
          <small className="cell-sub">{item.reference}</small>
          <div className="row-actions" aria-label="Feedback on this example">
            {feedback[item.id] ? <span className="cell-sub">{feedback[item.id]}</span> : <>
              <button type="button" className="button button-quiet" onClick={() => void sendFeedback(item.id, "helpful")}>Helpful</button>
              <button type="button" className="button button-quiet" onClick={() => void sendFeedback(item.id, "not_helpful")}>Not helpful</button>
              <button type="button" className="button button-quiet" onClick={() => { const note = window.prompt("What is wrong with this example?"); if (note?.trim()) void sendFeedback(item.id, "incorrect", note); }}>Incorrect</button>
              <button type="button" className="button button-quiet danger" onClick={() => { const note = window.prompt("Why could this identify a property or person? It will be withdrawn from use at once."); if (note?.trim()) void sendFeedback(item.id, "identifying", note); }}>Could identify someone</button>
            </>}
          </div>
        </li>)}</ul> : <p className="form-help assistant-empty">No reviewed examples match. {result.release.unsupportedSegments.length ? `Not yet covered: ${result.release.unsupportedSegments.join(", ")}.` : ""}</p>}
      </>}
    </div> : null}
  </section>;
}
