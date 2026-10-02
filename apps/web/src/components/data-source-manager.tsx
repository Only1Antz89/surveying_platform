"use client";

import { useMemo, useState } from "react";
import { Activity, ExternalLink, History, Search } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import type { SourceOperationsView } from "@surveynt/property-data/importers";

const freshnessText: Record<SourceOperationsView["freshness"]["state"], [string, "green" | "amber" | "slate" | "red" | "blue"]> = {
  current: ["Current", "green"], release_check_due: ["Release check due", "amber"], not_imported: ["Not imported", "slate"], live_api: ["Live API", "blue"], blocked: ["Blocked", "red"],
};
const registerTone: Record<string, "green" | "amber" | "red" | "slate"> = { verified: "green", pending: "amber", blocked: "red" };
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";

/**
 * Operator view of the source register. Enabling a source records what was
 * verified; heavy imports stay in the operator CLI. Every action is audited.
 */
export function DataSourceManager({ sources: initial, canOperate, demo }: { sources: SourceOperationsView[]; canOperate: boolean; demo: boolean }) {
  const [sources, setSources] = useState(initial);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const visible = useMemo(() => sources.filter((source) => `${source.name} ${source.organisation} ${source.key} ${source.category}`.toLowerCase().includes(query.toLowerCase())), [sources, query]);
  const current = sources.find((source) => source.key === selected) ?? null;

  async function refresh() {
    const response = await fetch("/api/platform/data-sources", { cache: "no-store" });
    if (response.ok) setSources((await response.json()).data);
  }

  async function act(url: string, body: Record<string, unknown>, done: string) {
    setBusy(true); setMessage(null);
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) return setMessage({ tone: "error", text: payload?.error?.message ?? "The action failed." });
    setMessage({ tone: "success", text: payload?.meta?.demo ? "Demo workspace: nothing was changed." : payload?.data?.probe ? `Probe: ${payload.data.probe.status} (${payload.data.probe.message})` : done });
    setNotes("");
    await refresh();
  }

  const counts = { enabled: sources.filter((source) => source.enabled).length, due: sources.filter((source) => source.freshness.state === "release_check_due").length, blocked: sources.filter((source) => source.registerStatus === "blocked").length };

  return <>
    <header className="page-header"><div><span className="eyebrow">Platform operations</span><h1>Data sources</h1><p>{sources.length} registered sources · {counts.enabled} enabled · {counts.due} due a release check · {counts.blocked} blocked. Imports run in the operator CLI; see the runbook.</p></div></header>
    {demo ? <p className="address-demo-label">Demo workspace: registry only. Nothing is imported or enabled, and actions are not saved.</p> : null}
    {message ? <p className={message.tone === "error" ? "form-error" : "form-success"} role="status">{message.text}</p> : null}
    <section className="panel">
      <div className="toolbar"><div className="search"><Search /><input className="input" placeholder="Search sources" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search sources" /></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Source</th><th>Register</th><th>Enabled</th><th>Active versions</th><th>Freshness</th><th>Health</th><th>Record</th></tr></thead><tbody>
        {visible.map((source) => <tr key={source.key}>
          <td data-label="Source"><strong>{source.name}</strong><span className="cell-sub">{source.organisation} · {source.category} · {source.coverage.join(", ")}</span><span className="reference">{source.key}</span></td>
          <td data-label="Register"><StatusDot tone={registerTone[source.registerStatus] ?? "slate"}>{source.registerStatus}</StatusDot></td>
          <td data-label="Enabled">{source.enabled ? <StatusDot tone="green">Enabled</StatusDot> : <StatusDot tone="slate">Disabled</StatusDot>}{source.verifiedAt ? <span className="cell-sub">Verified {formatDate(source.verifiedAt)}</span> : null}</td>
          <td data-label="Active versions">{source.active.length ? source.active.map((sync) => <span key={sync.id} className="cell-sub">{sync.layer || "default"}: {sync.datasetVersion} ({sync.recordCount.toLocaleString("en-GB")})</span>) : <span className="cell-sub">{source.accessMethod === "api" ? "Live API" : "None"}</span>}</td>
          <td data-label="Freshness"><StatusDot tone={freshnessText[source.freshness.state][1]}>{freshnessText[source.freshness.state][0]}</StatusDot></td>
          <td data-label="Health">{source.probe ? <><StatusDot tone={source.probe.status === "ok" ? "green" : source.probe.status === "failed" ? "red" : "slate"}>{source.probe.status === "ok" ? "Responding" : source.probe.status === "failed" ? "Failing" : "Not probed"}</StatusDot><span className="cell-sub">{formatDate(source.probe.at)}</span></> : <span className="cell-sub">No probe yet</span>}</td>
          <td data-label="Record"><button type="button" className="button button-quiet" onClick={() => { setSelected(source.key); setNotes(""); setMessage(null); }}><History size={14} />Manage</button></td>
        </tr>)}
      </tbody></table></div>
    </section>
    {current ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <section className="modal data-source-modal" role="dialog" aria-modal="true" aria-labelledby="source-title">
        <div className="modal-header"><div><span className="eyebrow">{current.key}</span><h2 id="source-title">{current.name}</h2><p>{current.guardrail}</p></div><button className="icon-button" aria-label="Close" onClick={() => setSelected(null)}>×</button></div>
        <div className="data-source-body">
          <dl className="detail-grid">
            <div className="detail"><dt>Register status</dt><dd>{current.registerStatus}</dd></div>
            <div className="detail"><dt>Access</dt><dd>{current.accessMethod === "api" ? "Live API" : "Bulk import"} · refresh policy {current.refreshDays} days</dd></div>
            <div className="detail"><dt>Verification</dt><dd>{current.verificationNotes ?? "Not verified"}{current.verifiedBy ? ` (${current.verifiedBy}, ${formatDate(current.verifiedAt)})` : ""}</dd></div>
            <div className="detail"><dt>Freshness</dt><dd>{current.freshness.basis}{current.freshness.dueAt ? ` Due ${formatDate(current.freshness.dueAt)}.` : ""}</dd></div>
            <div className="detail"><dt>Last release check</dt><dd>{current.releaseCheck ? `${formatDate(current.releaseCheck.at)}: ${current.releaseCheck.note}` : "None recorded"}</dd></div>
            <div className="detail"><dt>Last probe</dt><dd>{current.probe ? `${current.probe.status}: ${current.probe.message}` : "None"}</dd></div>
          </dl>
          <a className="button button-quiet" href={current.documentationUrl} target="_blank" rel="noopener noreferrer">Official documentation<ExternalLink size={12} aria-hidden="true" /></a>
          {canOperate ? <div className="data-source-actions">
            <label className="field"><span>Notes (what you verified or checked)</span><textarea className="textarea" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} placeholder="For example: licence and terms checked on the official page on 2 Oct 2026; endpoint confirmed" /></label>
            <div className="row-actions">
              {current.enabled ? <button type="button" className="button button-secondary danger" disabled={busy} onClick={() => void act(`/api/platform/data-sources/${current.key}`, { action: "disable" }, "Source disabled.")}>Disable</button>
                : <button type="button" className="button button-primary" disabled={busy || current.registerStatus === "blocked" || notes.trim().length < 20} onClick={() => void act(`/api/platform/data-sources/${current.key}`, { action: "enable", notes }, "Source enabled and verification recorded.")}>Enable after verification</button>}
              {current.accessMethod === "bulk_import" ? <button type="button" className="button button-secondary" disabled={busy || notes.trim().length < 10} onClick={() => void act(`/api/platform/data-sources/${current.key}`, { action: "release_checked", notes }, "Release check recorded.")}>Record release check</button> : <button type="button" className="button button-secondary" disabled={busy} onClick={() => void act(`/api/platform/data-sources/${current.key}`, { action: "probe" }, "Probe recorded.")}><Activity size={14} />Probe now</button>}
            </div>
            {current.registerStatus === "blocked" ? <p className="identity-warning">Blocked in the source register. Resolve the licence or access issue in the register first.</p> : null}
          </div> : <p className="form-help">Compliance or super-admin access is needed to change sources.</p>}
          <h3>Import history</h3>
          {current.history.length ? <ul className="sync-history">{current.history.map((sync) => <li key={sync.id}>
            <div><strong>{sync.layer || "default"} · {sync.datasetVersion}</strong> <StatusDot tone={sync.status === "active" ? "green" : sync.status === "failed" ? "red" : sync.status === "staging" ? "amber" : "slate"}>{sync.status}</StatusDot></div>
            <span className="cell-sub">{sync.recordCount.toLocaleString("en-GB")} records · {sync.extent ?? "full"} · by {sync.importedBy ?? "operator"} · started {formatDate(sync.startedAt)}{sync.activatedAt ? ` · activated ${formatDate(sync.activatedAt)}` : ""}</span>
            {sync.error ? <span className="form-error">{sync.error}</span> : null}
            {canOperate ? <div className="row-actions">
              {sync.status === "staging" && sync.completedAt ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => { if (window.confirm(`Activate ${sync.datasetVersion}? The current version is kept for rollback.`)) void act(`/api/platform/data-sources/syncs/${sync.id}`, { action: "activate" }, "Version activated and cached responses cleared."); }}>Activate</button> : null}
              {sync.status === "active" ? <button type="button" className="button button-quiet" disabled={busy} onClick={() => { if (window.confirm("Roll back to the previous version of this layer?")) void act(`/api/platform/data-sources/${current.key}`, { action: "rollback", layer: sync.layer }, "Rolled back to the previous version."); }}>Roll back</button> : null}
            </div> : null}
          </li>)}</ul> : <p className="form-help">No imports recorded. Import with the operator CLI (see the runbook).</p>}
        </div>
      </section>
    </div> : null}
  </>;
}
