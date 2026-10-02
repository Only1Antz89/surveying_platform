"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ClipboardList, X } from "lucide-react";
import { OTHER_OVERRIDE, type CompletionOverride } from "@surveynt/assistant";

export type StageGateFailure = { id: string; title: string; detail: string | null; category: string; overrideReasons: string[]; justification: string | null };
export type StageGateDetails = { surveyId: string; ruleSetVersion: string; mayOverride: boolean; failures: StageGateFailure[]; invalidOverrides: { itemId: string; message: string }[] };

/**
 * Shown when a move to internal review or issue is refused. Each failing check
 * either needs resolving in the survey or, where permitted, a recorded reason.
 * Nothing is submitted until every failure has a valid reason.
 */
export function StageGateDialog({ details, message, surveyHref, busy, onSubmit, onClose }: { details: StageGateDetails; message: string; surveyHref: string; busy: boolean; onSubmit: (overrides: CompletionOverride[]) => void; onClose: () => void }) {
  const [choices, setChoices] = useState<Record<string, { reason: string; note: string }>>({});
  const fixed = details.failures.filter((failure) => !failure.overrideReasons.length);
  const invalid = new Map(details.invalidOverrides.map((item) => [item.itemId, item.message]));
  const complete = details.mayOverride && !fixed.length && details.failures.every((failure) => {
    const choice = choices[failure.id];
    return choice?.reason && (choice.reason !== OTHER_OVERRIDE || choice.note.trim().length >= 10);
  });
  const set = (id: string, change: Partial<{ reason: string; note: string }>) => setChoices({ ...choices, [id]: { ...(choices[id] ?? { reason: "", note: "" }), ...change } });

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal stage-gate-modal" role="dialog" aria-modal="true" aria-labelledby="stage-gate-title">
      <div className="modal-header"><div><span className="eyebrow">Completion checks · rules {details.ruleSetVersion}</span><h2 id="stage-gate-title">This stage change needs attention</h2><p>{message}</p></div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
      <p className="stage-gate-summary">{fixed.length ? `${fixed.length} must be resolved in the survey` : "None need resolving in the survey"}{details.failures.length - fixed.length ? ` · ${details.failures.length - fixed.length} can proceed with a recorded reason` : ""}.</p>
      <ul className="stage-gate-list">
        {details.failures.map((failure) => <li key={failure.id}>
          <strong><AlertTriangle size={14} aria-hidden="true" />{failure.title}</strong>
          {failure.detail ? <span>{failure.detail}</span> : null}
          {failure.justification ? <span className="cell-sub">Why: {failure.justification}</span> : null}
          {!failure.overrideReasons.length ? <span className="cell-sub stage-gate-fixed">Resolve this in the survey. It cannot be overridden.</span>
            : details.mayOverride ? <div className="stage-gate-override">
              <label className="sr-only" htmlFor={`reason-${failure.id}`}>Reason for {failure.title}</label>
              <select id={`reason-${failure.id}`} className="select" value={choices[failure.id]?.reason ?? ""} onChange={(event) => set(failure.id, { reason: event.target.value })}>
                <option value="">Resolve in the survey, or choose a reason…</option>
                {failure.overrideReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </select>
              <label className="sr-only" htmlFor={`note-${failure.id}`}>Note for {failure.title}</label>
              <input id={`note-${failure.id}`} className="input" placeholder={choices[failure.id]?.reason === OTHER_OVERRIDE ? "Explain (required)" : "Note (optional)"} value={choices[failure.id]?.note ?? ""} onChange={(event) => set(failure.id, { note: event.target.value })} maxLength={1000} />
            </div> : null}
          {invalid.get(failure.id) ? <span className="form-error">{invalid.get(failure.id)}</span> : null}
        </li>)}
      </ul>
      {!details.mayOverride ? <p className="identity-warning">Only a surveyor, administrator or owner can record reasons for proceeding.</p> : null}
      <div className="modal-actions">
        <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
        <Link className="button button-secondary" href={surveyHref}><ClipboardList size={14} />Open survey</Link>
        {details.mayOverride && !fixed.length ? <button type="button" className="button button-primary" disabled={!complete || busy} onClick={() => onSubmit(details.failures.map((failure) => ({ itemId: failure.id, reason: choices[failure.id].reason, note: choices[failure.id].note.trim() || null })))}>{busy ? "Saving…" : "Record reasons and continue"}</button> : null}
      </div>
    </section>
  </div>;
}
