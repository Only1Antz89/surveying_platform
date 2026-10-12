"use client";
import {workspaceFetch} from "@/lib/workspace-request";

import { type FormEvent, useState } from "react";
import { StatusDot } from "@surveynt/ui";
import { aiUseLabels, aiUses, type AiUse } from "@surveynt/assistant";
import type { loadAssistantMetrics, loadModelRegister } from "@/lib/ai-governance";

type Metrics = Awaited<ReturnType<typeof loadAssistantMetrics>>;
type RegisterEntry = Awaited<ReturnType<typeof loadModelRegister>>[number];

function Table({ rows, columns }: { rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length) return <p className="form-help assistant-empty">No records yet.</p>;
  return <div className="data-table-wrap"><table className="metric-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/_/g, " ")}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column} className={typeof row[column] === "number" ? "number" : undefined}>{String(row[column] ?? "")}</td>)}</tr>)}</tbody></table></div>;
}

/**
 * Platform oversight: totals across all firms (no firm is named), the model
 * register, and operations. A model is usable only once approved with
 * recorded evaluation results; suspension takes effect at once.
 */
export function AssistantOversight({ metrics, register: initial, canManage, demo }: { metrics: Metrics | null; register: RegisterEntry[]; canManage: boolean; demo: boolean }) {
  const [register, setRegister] = useState(initial);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(url: string, body: unknown, done: string) {
    setBusy(true); setMessage(null);
    const response = await workspaceFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) return setMessage({ tone: "error", text: payload?.error?.message ?? "The change failed." });
    setMessage({ tone: "success", text: payload?.meta?.demo ? "Demo workspace: nothing was saved." : done });
    const list = await workspaceFetch("/api/platform/ai-models", { cache: "no-store" });
    if (list.ok) setRegister((await list.json()).data);
  }

  function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    void send("/api/platform/ai-models", { providerKey: value("providerKey"), modelId: value("modelId"), modelVersion: value("modelVersion"), uses: form.getAll("uses").map(String), processingLocation: value("processingLocation"), retentionTerms: value("retentionTerms"), notes: value("notes") || null }, "Model proposed for evaluation.");
  }

  const proposals = metrics?.proposals ?? [];
  const decided = proposals.filter((row) => ["accepted", "edited", "rejected"].includes(String(row.status)));
  const total = (status: string) => decided.filter((row) => row.status === status).reduce((sum, row) => sum + Number(row.count), 0);
  const decidedTotal = decided.reduce((sum, row) => sum + Number(row.count), 0);
  const rate = (value: number) => (decidedTotal ? `${Math.round((value / decidedTotal) * 100)}%` : "—");

  return <>
    {demo ? <p className="address-demo-label">Demo workspace: no platform data is loaded and nothing is saved.</p> : null}
    {message ? <p className={message.tone === "error" ? "form-error" : "form-success"} role="status">{message.text}</p> : null}
    <section className="panel">
      <div className="panel-header"><div><h2>Suggestion review outcomes</h2><p>All firms combined. Rejections with notes are evaluation feedback, never training data.</p></div></div>
      <div className="metric-strip">
        <div><strong>{decidedTotal}</strong><span>reviewed</span></div>
        <div><strong>{rate(total("accepted"))}</strong><span>accepted as suggested</span></div>
        <div><strong>{rate(total("edited"))}</strong><span>edited before accepting</span></div>
        <div><strong>{rate(total("rejected"))}</strong><span>rejected ({metrics?.rejectedWithNotes ?? 0} with notes)</span></div>
      </div>
      <Table rows={proposals} columns={["origin", "status", "count"]} />
    </section>
    <section className="panel">
      <div className="panel-header"><div><h2>Checks, reports and incidents</h2><p>Discrepancies, reminders and overrides show where records and surveyors disagree. Unsupported-claim and abstention results come from the evaluation pack (<code>pnpm --filter @surveynt/evidence eval</code>), which must pass before any model is approved.</p></div></div>
      <h3 className="metric-heading">Assistant tasks</h3><Table rows={metrics?.tasks ?? []} columns={["kind", "status", "count"]} />
      <h3 className="metric-heading">Completion overrides by rule</h3><Table rows={metrics?.overrides ?? []} columns={["rule", "count"]} />
      <h3 className="metric-heading">Reports</h3><Table rows={metrics ? [metrics.reports] : []} columns={["composed", "signed_off"]} />
      <h3 className="metric-heading">AI incidents</h3><Table rows={metrics?.incidents ?? []} columns={["category", "severity", "status", "count"]} />
      <h3 className="metric-heading">Firms</h3><Table rows={metrics ? [metrics.firms] : []} columns={["ai_enabled", "configured"]} />
    </section>
    <section className="panel">
      <div className="panel-header"><div><h2>Operations</h2><p>Queue depth, enrichment runs in the last seven days, and evidence analyses.</p></div></div>
      <h3 className="metric-heading">Background jobs</h3><Table rows={metrics?.operations.jobs ?? []} columns={["queue", "status", "count"]} />
      <h3 className="metric-heading">Enrichment runs (7 days)</h3><Table rows={metrics?.operations.enrichmentRuns7d ?? []} columns={["status", "count"]} />
      <h3 className="metric-heading">Evidence analyses</h3><Table rows={metrics?.operations.mediaAnalyses ?? []} columns={["analyser", "status", "count"]} />
    </section>
    <section className="panel">
      <div className="panel-header"><div><h2>Model register</h2><p>Empty until a provider is chosen. Approval needs recorded evaluation results; a firm still needs its own settings, risk assessment and each client&apos;s consent.</p></div></div>
      {register.length ? <ul className="ai-list">{register.map((entry) => <li key={entry.id}>
        <div className="wording-head"><strong>{entry.providerKey} · {entry.modelId} {entry.modelVersion}</strong><StatusDot tone={entry.status === "approved" ? "green" : entry.status === "proposed" ? "amber" : "slate"}>{entry.status}</StatusDot></div>
        <span className="cell-sub">{entry.uses.map((use) => aiUseLabels[use as AiUse] ?? use).join(", ")} · processing {entry.processingLocation ?? "—"} · retention {entry.retentionTerms ?? "—"}</span>
        {canManage ? <div className="row-actions">
          {entry.status !== "approved" && entry.status !== "retired" ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => { const summary = window.prompt("Paste the evaluation result (for example: evaluation pack 11/11, abstentions 4/4, unsupported claims 0, run 2026-10-02)"); if (summary?.trim()) void send(`/api/platform/ai-models/${entry.id}`, { status: "approved", evaluationSummary: { result: summary.trim() } }, "Model approved."); }}>Approve with evaluation</button> : null}
          {entry.status === "approved" ? <button type="button" className="button button-quiet danger" disabled={busy} onClick={() => void send(`/api/platform/ai-models/${entry.id}`, { status: "suspended" }, "Model suspended.")}>Suspend</button> : null}
          {entry.status !== "retired" ? <button type="button" className="button button-quiet" disabled={busy} onClick={() => void send(`/api/platform/ai-models/${entry.id}`, { status: "retired" }, "Model retired.")}>Retire</button> : null}
        </div> : null}
      </li>)}</ul> : <p className="form-help assistant-empty">No models registered.</p>}
      {canManage ? <form className="form-section" onSubmit={propose}>
        <div className="form-grid">
          <div className="field"><label htmlFor="model-provider">Provider key</label><input id="model-provider" name="providerKey" className="input" required pattern="[a-z0-9][a-z0-9_\-]{1,40}" /></div>
          <div className="field"><label htmlFor="model-id">Model</label><input id="model-id" name="modelId" className="input" required maxLength={120} /></div>
          <div className="field"><label htmlFor="model-version">Version</label><input id="model-version" name="modelVersion" className="input" required maxLength={60} /></div>
          <div className="field"><label htmlFor="model-location">Processing location</label><input id="model-location" name="processingLocation" className="input" required maxLength={200} /></div>
          <div className="field full"><label htmlFor="model-retention">Retention terms</label><input id="model-retention" name="retentionTerms" className="input" required minLength={5} maxLength={1000} /></div>
          <fieldset className="field full"><legend>Uses</legend><div className="check-row">{aiUses.map((use) => <label key={use} className="check-field"><input type="checkbox" name="uses" value={use} />{aiUseLabels[use]}</label>)}</div></fieldset>
          <div className="field full"><label htmlFor="model-notes">Notes</label><input id="model-notes" name="notes" className="input" maxLength={2000} /></div>
        </div>
        <div className="form-actions"><button className="button button-secondary" disabled={busy}>Propose model</button></div>
      </form> : null}
    </section>
  </>;
}
