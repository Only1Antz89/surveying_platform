"use client";

import { useState } from "react";
import { AlertTriangle, Check, Lightbulb, PencilLine, RefreshCw, X } from "lucide-react";
import { proposalOriginLabels, resolveField, type EvidenceRef, type FieldValue, type FormTemplate, type ProposalOrigin } from "@surveynt/assistant";
import type { SurveyPack } from "@/lib/surveys";

function valueLabel(template: FormTemplate, fieldPath: string, value: FieldValue) {
  if (value.state !== "provided") return value.state.replace(/_/g, " ");
  const field = resolveField(template, fieldPath)?.field;
  if (field?.type === "condition_rating") return template.conditionRatingLabels[String(value.value) as "1"] ?? String(value.value);
  return field?.options?.find((option) => option.value === value.value)?.label ?? String(value.value);
}

/**
 * Suggestions and discrepancies for this survey. Nothing here changes the
 * form until a person accepts or edits it; professional assessments need an
 * explicit confirmation as well.
 */
export function AssistantPanel({ surveyId, pack, canEdit, canJudge, online, onChanged }: { surveyId: string; pack: SurveyPack; canEdit: boolean; canJudge: boolean; online: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const discrepancies = pack.tasks.filter((task) => task.kind === "discrepancy" && task.status === "open");

  async function review(proposalId: string, body: Record<string, unknown>) {
    setBusy(proposalId); setMessage(null);
    const response = await fetch(`/api/v1/surveys/${surveyId}/proposals/${proposalId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => null);
    setBusy(null);
    if (!response.ok) setMessage(payload?.error?.message ?? "The suggestion could not be reviewed.");
    else if (payload?.meta?.demo) setMessage("Demo workspace: review decisions are not saved.");
    setEditing(null);
    await onChanged();
  }

  async function refresh() {
    setBusy("refresh"); setMessage(null);
    const response = await fetch(`/api/v1/surveys/${surveyId}/proposals`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    setBusy(null);
    if (!response.ok) setMessage(payload?.error?.message ?? "Suggestions could not be refreshed.");
    else setMessage(`${payload.data.created} new suggestion${payload.data.created === 1 ? "" : "s"}; ${payload.data.discrepancies} new discrepanc${payload.data.discrepancies === 1 ? "y" : "ies"}.`);
    await onChanged();
  }

  async function closeTask(taskId: string, status: "resolved" | "dismissed") {
    const note = window.prompt(status === "resolved" ? "How was this resolved?" : "Why is this being dismissed?");
    if (note === null) return;
    setBusy(taskId);
    await fetch(`/api/v1/surveys/${surveyId}/tasks/${taskId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, note: note.trim() || null }) });
    setBusy(null);
    await onChanged();
  }

  // Packs cached offline before the flag existed have no value; the server still enforces it.
  const enabled = pack.assistantEnabled !== false;
  if (!discrepancies.length && (!enabled || (!pack.proposals.length && !canEdit))) return null;

  return <section className="panel assistant-panel" aria-labelledby="assistant-heading">
    <div className="panel-header"><div><h2 id="assistant-heading">Suggestions and checks</h2><p>Suggestions come from cited records. They change nothing until you accept them.</p></div>
      {canEdit && enabled ? <button type="button" className="button button-quiet" onClick={() => void refresh()} disabled={!online || busy !== null}><RefreshCw size={14} />Refresh suggestions</button> : null}
    </div>
    {!online ? <p className="identity-warning">Reviewing suggestions needs a connection, so the server can check they are still current.</p> : null}
    {message ? <p className="form-success identity-message" role="status">{message}</p> : null}
    {discrepancies.length ? <div className="assistant-group"><h3><AlertTriangle size={14} aria-hidden="true" />Discrepancies</h3><ul>{discrepancies.map((task) => <li key={task.id} className="assistant-item discrepancy"><strong>{task.title}</strong><span>{task.detail}</span>{canEdit ? <div className="row-actions"><button type="button" className="button button-secondary" disabled={!online || busy !== null} onClick={() => void closeTask(task.id, "resolved")}>Mark resolved</button><button type="button" className="button button-quiet" disabled={!online || busy !== null} onClick={() => void closeTask(task.id, "dismissed")}>Dismiss</button></div> : null}</li>)}</ul></div> : null}
    {!enabled ? null : pack.proposals.length ? <div className="assistant-group"><h3><Lightbulb size={14} aria-hidden="true" />Suggestions</h3><ul>{pack.proposals.map((proposal) => {
      const resolved = resolveField(pack.template, proposal.fieldPath);
      const professional = resolved?.field.fieldClass === "professional_assessment";
      const value = proposal.proposedValue as unknown as FieldValue;
      const evidence = proposal.evidenceRefs as unknown as EvidenceRef[];
      const disabled = !online || busy !== null || !canEdit || (professional && !canJudge);
      return <li key={proposal.id} className="assistant-item">
        <div className="assistant-item-head"><strong>{resolved ? `${resolved.element.label}: ${resolved.field.label}` : proposal.fieldPath}</strong><span className="status status-amber">{proposalOriginLabels[proposal.originClass as ProposalOrigin] ?? proposal.originClass}</span></div>
        <p className="assistant-value">Suggested: <b>{valueLabel(pack.template, proposal.fieldPath, value)}</b></p>
        <ul className="assistant-evidence">{evidence.map((item) => <li key={`${item.type}-${item.id}`}>{item.label}{item.date ? ` · ${item.date.slice(0, 10)}` : ""}</li>)}</ul>
        {(proposal.limitations as string[]).length ? <ul className="assistant-limitations">{(proposal.limitations as string[]).map((item) => <li key={item}>{item}</li>)}</ul> : null}
        {professional ? <label className="check-field"><input type="checkbox" checked={Boolean(confirmed[proposal.id])} onChange={(event) => setConfirmed({ ...confirmed, [proposal.id]: event.target.checked })} disabled={!canJudge} /> I confirm this professional assessment from my own inspection.</label> : null}
        {editing === proposal.id ? <div className="assistant-edit">
          {resolved?.field.options ? <select className="select" value={editValue} onChange={(event) => setEditValue(event.target.value)} aria-label="Edited value"><option value="">Select…</option>{resolved.field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input className="input" value={editValue} onChange={(event) => setEditValue(event.target.value)} aria-label="Edited value" />}
          <button type="button" className="button button-primary" disabled={disabled || !editValue} onClick={() => void review(proposal.id, { decision: "edit", value: { state: "provided", value: editValue }, note: "Edited before accepting", confirmProfessional: confirmed[proposal.id] })}>Save edit</button>
          <button type="button" className="button button-quiet" onClick={() => setEditing(null)}>Cancel</button>
        </div> : <div className="row-actions">
          <button type="button" className="button button-secondary" disabled={disabled || (professional && !confirmed[proposal.id])} onClick={() => void review(proposal.id, { decision: "accept", confirmProfessional: confirmed[proposal.id] })}><Check size={14} />Accept</button>
          <button type="button" className="button button-quiet" disabled={disabled} onClick={() => { setEditing(proposal.id); setEditValue(value.state === "provided" ? String(value.value) : ""); }}><PencilLine size={14} />Edit</button>
          <button type="button" className="button button-quiet danger" disabled={!online || busy !== null || !canEdit} onClick={() => { const note = window.prompt("Why is this suggestion wrong? (recorded as evaluation feedback)"); if (note !== null) void review(proposal.id, { decision: "reject", note: note.trim() || null }); }}><X size={14} />Reject</button>
        </div>}
      </li>;
    })}</ul></div> : <p className="form-help assistant-empty">No pending suggestions. Refresh after the property intelligence is updated.</p>}
  </section>;
}
