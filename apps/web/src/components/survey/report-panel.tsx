"use client";

import { useCallback, useEffect, useState } from "react";
import { FileCheck2, FileText, RefreshCw } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { REPORT_SIGN_OFF_STATEMENT, type ComposedReport, type ReportBlock } from "@surveynt/assistant";

type VersionSummary = { id: string; versionNumber: number; createdAt: string; current: boolean; contentRemoved?: boolean; approval: { approvedAt: string; approverRole: string; note: string | null } | null };
type ReportState = { surveyStatus: string; versions: VersionSummary[]; latest: { id: string; versionNumber: number; content: ComposedReport } | null };

const sourceLabels: Record<string, string> = { field_value: "Field", observation: "Observation", clause: "Approved wording", media: "Photo", element: "Inspection status" };

function Block({ block }: { block: ReportBlock }) {
  return <div className={`report-block ${block.kind}`}>
    <p>{block.text.split("\n").map((line, index) => <span key={index}>{line}<br /></span>)}</p>
    <details className="report-sources"><summary>Sources ({block.sources.length})</summary><ul>{block.sources.map((source) => <li key={`${source.type}-${source.id}`}><b>{sourceLabels[source.type] ?? source.type}</b> {source.label}{source.version ? ` · v${source.version}` : ""}</li>)}</ul></details>
  </div>;
}

/**
 * Compose a report from recorded values, current observations and approved
 * wording; preview it with every block's sources; and sign it off. Sign-off
 * is always a person's explicit decision on one exact version.
 */
export function ReportPanel({ surveyId, canEdit, canJudge, online, demo, onChanged }: { surveyId: string; canEdit: boolean; canJudge: boolean; online: boolean; demo: boolean; onChanged: () => Promise<void> }) {
  const [state, setState] = useState<ReportState | null>(null);
  const [preview, setPreview] = useState<ComposedReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string; items?: { id: string; title: string }[] } | null>(null);

  const fetchState = useCallback(() => fetch(`/api/v1/surveys/${surveyId}/report`, { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ data: ReportState }> : null), [surveyId]);
  const apply = (payload: { data: ReportState } | null) => {
    if (!payload) return;
    setState(payload.data);
    // Keep an unsaved (demo) preview when nothing is stored yet.
    if (payload.data.versions[0]?.contentRemoved) setPreview(null);
    else if (payload.data.latest) setPreview(payload.data.latest.content);
  };
  const load = async () => { if (online) apply(await fetchState().catch(() => null)); };

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    fetchState().then((payload) => { if (!cancelled) apply(payload); }, () => undefined);
    return () => { cancelled = true; };
  }, [online, fetchState]);

  async function compose() {
    setBusy(true); setMessage(null); setConfirmed(false);
    const response = await fetch(`/api/v1/surveys/${surveyId}/report`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) return setMessage({ tone: "error", text: payload?.error?.message ?? "The report could not be composed." });
    setPreview(payload.data.content);
    setMessage({ tone: "success", text: payload.meta?.demo ? "Demo workspace: composed from invented records and demo wording; nothing is saved." : `Version ${payload.data.versionNumber} composed. Review it before signing off.` });
    await load();
  }

  async function signOff(version: VersionSummary) {
    setBusy(true); setMessage(null);
    const response = await fetch(`/api/v1/surveys/${surveyId}/report/${version.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true, statement: REPORT_SIGN_OFF_STATEMENT, note: note.trim() || null }) });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) return setMessage({ tone: "error", text: payload?.error?.message ?? "The report could not be signed off.", items: Array.isArray(payload?.error?.details) ? payload.error.details : undefined });
    setMessage({ tone: "success", text: `Version ${payload.data.versionNumber} signed off. Capture is now closed for this survey.` });
    setNote(""); setConfirmed(false);
    await load(); await onChanged();
  }

  async function reopen() {
    const reason = window.prompt("Why does the survey need to change after sign-off?");
    if (!reason || reason.trim().length < 10) return;
    setBusy(true);
    const response = await fetch(`/api/v1/surveys/${surveyId}/reopen`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    setMessage(response.ok ? { tone: "success", text: "Reopened. Compose and sign off a new version when the changes are done." } : { tone: "error", text: payload?.error?.message ?? "The survey could not be reopened." });
    await load(); await onChanged();
  }

  const latest = state?.versions[0] ?? null;
  const approved = state?.surveyStatus === "approved";
  const canSignOff = Boolean(canJudge && online && latest && latest.current && !latest.approval && !approved && !demo);

  return <section className="panel report-panel" aria-labelledby="report-heading">
    <div className="panel-header"><div><h2 id="report-heading">Report</h2><p>Assembled from recorded values, current observations and your firm&apos;s approved wording only. Nothing is generated.</p></div>
      {canEdit && !approved && !latest?.contentRemoved ? <button type="button" className="button button-secondary" disabled={!online || busy} onClick={() => void compose()}><RefreshCw size={14} />{latest ? "Compose new version" : "Compose draft"}</button> : null}
    </div>
    {!online ? <p className="identity-warning intel-inline">Composing and signing off need a connection.</p> : null}
    {message ? <div className={message.tone === "error" ? "form-error report-message" : "form-success report-message"} role="status">{message.text}{message.items?.length ? <ul>{message.items.map((item) => <li key={item.id}>{item.title}</li>)}</ul> : null}</div> : null}
    {state?.versions.length ? <ul className="report-versions">{state.versions.slice(0, 5).map((version) => <li key={version.id}>
      <FileText size={14} aria-hidden="true" /><span>Version {version.versionNumber} · {new Date(version.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
      {version.approval ? <StatusDot tone="green">Signed off</StatusDot> : <StatusDot tone="amber">Draft</StatusDot>}
      {version.contentRemoved ? <StatusDot tone="slate">Content removed</StatusDot> : !version.current ? <StatusDot tone="slate">Out of date</StatusDot> : null}
    </li>)}</ul> : null}
    {approved ? <div className="report-signed"><p><FileCheck2 size={15} aria-hidden="true" /> Signed off. Capture is closed for this survey.</p>{canJudge && !latest?.contentRemoved ? <button type="button" className="button button-quiet" disabled={busy || !online} onClick={() => void reopen()}>Reopen for changes</button> : null}</div> : null}
    {preview ? <article className="report-preview" aria-label="Report preview">
      <header><h3>{preview.title}</h3><p>{preview.property.line1}{preview.property.city ? `, ${preview.property.city}` : ""} · {preview.jobReference} · template {preview.templateVersion}</p></header>
      {preview.ratingSummary.length ? <div className="report-ratings">{preview.ratingSummary.map((group) => <div key={group.rating}><strong>{group.label}</strong><span>{group.elements.map((element) => element.title).join(", ")}</span></div>)}</div> : null}
      {preview.sections.map((section) => section.blocks.length || section.elements.length ? <section key={section.key}><h4>{section.title}</h4>
        {section.blocks.map((block) => <Block key={block.id} block={block} />)}
        {section.elements.map((element) => <div key={element.key} className="report-element"><h5>{element.title}</h5>{element.blocks.map((block) => <Block key={block.id} block={block} />)}</div>)}
      </section> : null)}
      {preview.recommendations.length ? <section><h4>Recommendations</h4>{preview.recommendations.map((block) => <Block key={block.id} block={block} />)}</section> : null}
      {preview.omissions.length ? <section className="report-omissions"><h4>Left out of this version</h4><ul>{preview.omissions.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    </article> : <p className="form-help assistant-empty">{latest?.contentRemoved ? "Report content was removed after retention review. Version and approval records remain." : "No report composed yet."}</p>}
    {canSignOff && latest ? <div className="report-signoff">
      <label className="check-field"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> {REPORT_SIGN_OFF_STATEMENT}</label>
      <input className="input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Note (optional)" aria-label="Sign-off note" />
      <button type="button" className="button button-primary" disabled={!confirmed || busy} onClick={() => void signOff(latest)}><FileCheck2 size={14} />Sign off version {latest.versionNumber}</button>
    </div> : null}
    {latest && !latest.contentRemoved && !latest.current && !approved ? <p className="identity-warning intel-inline">The survey or approved wording changed after version {latest.versionNumber} was composed. Compose a new version to sign off.</p> : null}
  </section>;
}
