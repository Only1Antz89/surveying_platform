"use client";
import { useContext } from "react";
import { evidenceMapping, resolveField } from "@surveynt/assistant";
import { AssistantPanel } from "./assistant-panel";
import { SurveyEvidenceContext, sourceStatusLabels } from "./survey-evidence-context";

export function FieldEvidence({ path }: { path: string }) {
  const context = useContext(SurveyEvidenceContext);
  const mapping = evidenceMapping(path);
  if (!context || !mapping || !context.pack.template.key.startsWith("surveynt-home-survey-")) return null;
  const pending = context.pack.proposals.filter(proposal => proposal.fieldPath === path).length;
  return <details className="field-evidence"><summary aria-label={`Evidence assistance for ${resolveField(context.pack.template, path)?.field.label ?? path}`}>Evidence assistance{pending ? ` · ${pending} suggestion${pending === 1 ? "" : "s"}` : ""}</summary>
    <p className="form-help">{mapping.mode === "context_only" ? "Context only — not an inspection answer." : "Review each proposed answer before applying."} {mapping.boundary}</p>
    {!context.online ? <p className="form-help">Current evidence cannot be checked while offline or device changes are awaiting sync.</p> : context.preview ? <p className="form-help">Preview: source availability is not verified.</p> : context.error ? <p role="status">{context.error}</p> : <ul>{mapping.sources.map(key => {
      const source = context.sources?.find(source => source.key === key);
      return <li key={key}><strong>{source?.name ?? key.replace(/_/g, " ")}</strong>: {source ? sourceStatusLabels[source.status] ?? source.status : context.sources === null ? "Loading status…" : "Not checked"}
        {source?.guardrail ? <p className="form-help">{source.guardrail}</p> : null}
        {source?.categories.map(category => <p className="form-help" key={category.category}>{category.category.replace(/_/g, " ")} · {category.coverage.replace(/_/g, " ")} · {category.status.replace(/_/g, " ")}{category.retrievedAt ? ` · Retrieved ${new Date(category.retrievedAt).toLocaleDateString("en-GB")}` : ""}</p>)}
      </li>;
    })}</ul>}
    {pending > 1 ? <p role="status" className="identity-warning">Multiple sources are presented separately. They may conflict; no preferred answer is selected.</p> : null}
    {context.online && !context.error && !context.preview && context.fieldContexts.get(path)?.length ? <div><h4>Context to review — not an answer</h4><ul>{context.fieldContexts.get(path)?.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
    <AssistantPanel {...context} fieldPath={path} />
    {!pending ? <p className="form-help">No pending suggestion for this question. Check source status and load evidence in the assistance panel, or enter manually.</p> : null}
  </details>;
}
