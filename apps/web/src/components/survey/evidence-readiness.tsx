"use client";

import { useContext } from "react";
import { SurveyEvidenceContext, sourceStatusLabels as labels } from "./survey-evidence-context";

export function EvidenceReadiness() {
  const context = useContext(SurveyEvidenceContext);
  if (!context) return null;
  const { sources, error, preview, online } = context;
  return <details className="assistant-group"><summary>Current source status</summary>
    {!online ? <p className="form-help">Offline: current source status cannot be verified. Cached findings remain separate.</p> : error ? <p role="status">{error}</p> : preview ? <p className="form-help">Preview only. Connect the persistent demo to inspect actual source status.</p> : sources === null ? <p role="status">Loading source status…</p> : <ul>{sources.map(source => <li className="assistant-item" key={source.key}><strong>{source.name}</strong><span>{labels[source.status] ?? source.status}</span><p>{source.coverageNotes}</p><p className="form-help">{source.guardrail}</p>{source.categories.map(category => <details key={category.category}><summary>{category.category.replace(/_/g, " ")} · {category.coverage.replace(/_/g, " ")}</summary><p>Retrieved {new Date(category.retrievedAt).toLocaleDateString()} · {category.fresh ? "Current" : "Needs review"}</p>{category.evidence.map((evidence, index) => /^https?:\/\//.test(evidence.url) ? <p key={index}><a href={evidence.url} target="_blank" rel="noopener noreferrer">{evidence.label}</a></p> : <p key={index}>{evidence.label}</p>)}</details>)}</li>)}</ul>}
  </details>;
}
