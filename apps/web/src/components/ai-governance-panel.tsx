"use client";

import { type FormEvent, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { aiUseLabels, aiUses, type AiUse } from "@surveynt/assistant";
import type { loadAiGovernance } from "@/lib/ai-governance";

type Governance = Awaited<ReturnType<typeof loadAiGovernance>>;

const severityTone = { low: "slate", medium: "amber", high: "red", critical: "red" } as const;

/**
 * AI settings for the firm: off by default. Turning a use on is only one of
 * several conditions: the platform must also have an approved model, the use
 * an approved risk assessment, and each job the client's consent.
 */
export function AiGovernancePanel({ initial, canManage, canReport, demo }: { initial: Governance; canManage: boolean; canReport: boolean; demo: boolean }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function refresh() {
    const response = await fetch("/api/v1/ai/governance", { cache: "no-store" });
    if (response.ok) setData((await response.json()).data);
  }

  async function send(url: string, method: string, body: unknown, done: string) {
    setBusy(true); setMessage(null);
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) { setMessage({ tone: "error", text: [payload?.error?.message ?? "The change failed.", ...Object.values((payload?.error?.details?.fieldErrors ?? {}) as Record<string, string[]>).flat()].join(" ") }); return false; }
    setMessage({ tone: "success", text: payload?.meta?.demo ? "Demo workspace: nothing was saved." : done });
    await refresh();
    return true;
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send("/api/v1/ai/settings", "PUT", { aiFeaturesEnabled: form.get("enabled") === "on", permittedUses: form.getAll("uses").map(String), disclosureText: String(form.get("disclosure") ?? "").trim() || null, version: data.settings.version }, "AI settings saved.");
  }

  async function addAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    if (await send("/api/v1/ai/risk-assessments", "POST", { use: value("use"), title: value("title"), summary: value("summary"), reviewDue: value("reviewDue"), risks: [{ risk: value("risk"), likelihood: value("likelihood"), impact: value("impact"), mitigation: value("mitigation") }] }, "Risk assessment drafted.")) formElement.reset();
  }

  async function reportIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (await send("/api/v1/ai/incidents", "POST", { category: String(form.get("category")), severity: String(form.get("severity")), description: String(form.get("description") ?? "").trim() }, "Incident reported.")) formElement.reset();
  }

  return <div className="ai-governance">
    {demo ? <p className="address-demo-label">Demo workspace: AI features are off and nothing is saved.</p> : null}
    {!data.providerConfigured ? <p className="identity-warning"><ShieldAlert size={14} aria-hidden="true" /> No AI provider is configured for this deployment, so no AI feature can run whatever is set here. Suggestions from records, completion checks and report assembly do not use AI.</p> : null}
    {message ? <p className={message.tone === "error" ? "form-error" : "form-success"} role="status">{message.text}</p> : null}

    <section className="panel">
      <div className="panel-header"><div><h2>Firm settings</h2><p>Off by default. A use runs only when it is on here, covered by an approved risk assessment, approved in the platform model register, and agreed by the client for that job.</p></div></div>
      <form className="form-section" onSubmit={saveSettings}>
        <label className="check-field"><input type="checkbox" name="enabled" defaultChecked={data.settings.aiFeaturesEnabled} disabled={!canManage} /> Allow AI features for this firm</label>
        <fieldset className="field"><legend>Permitted uses</legend><div className="check-row">{aiUses.map((use) => <label key={use} className="check-field"><input type="checkbox" name="uses" value={use} defaultChecked={data.settings.permittedUses.includes(use)} disabled={!canManage} />{aiUseLabels[use]}</label>)}</div></fieldset>
        <div className="field"><label htmlFor="ai-disclosure">Client disclosure (version {data.settings.disclosureVersion || "none"})</label><textarea id="ai-disclosure" name="disclosure" className="textarea" rows={4} maxLength={4000} defaultValue={data.settings.disclosureText ?? ""} disabled={!canManage} placeholder="Explain to clients what AI assistance is used for, that a surveyor reviews every output, and how to decline." /><span className="form-help">Changing the text creates a new version; consent given against an earlier version must be asked for again.</span></div>
        {canManage ? <div className="form-actions"><button className="button button-primary" disabled={busy}>Save settings</button></div> : <p className="form-help">Owners and administrators can change these settings.</p>}
      </form>
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Approved models</h2><p>Models approved by the platform after evaluation. None means AI cannot run.</p></div></div>
      {data.approvedModels.length ? <ul className="ai-list">{data.approvedModels.map((model) => <li key={`${model.providerKey}-${model.modelId}-${model.modelVersion}`}><strong>{model.providerKey} · {model.modelId} {model.modelVersion}</strong><span className="cell-sub">{model.uses.map((use) => aiUseLabels[use as AiUse] ?? use).join(", ")}</span></li>)}</ul> : <p className="form-help assistant-empty">No approved models.</p>}
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Risk assessments</h2><p>Each use needs an approved assessment that is within its review date.</p></div></div>
      {data.assessments.length ? <ul className="ai-list">{data.assessments.map((item) => <li key={item.id}>
        <div className="wording-head"><strong>{item.title}</strong><StatusDot tone={item.status === "approved" ? "green" : item.status === "draft" ? "amber" : "slate"}>{item.status}</StatusDot><span className="cell-sub">{aiUseLabels[item.use as AiUse] ?? item.use} · review by {item.reviewDue ?? "—"}</span></div>
        <span className="cell-sub">{item.summary}</span>
        {item.status === "draft" && canManage ? <div className="row-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => void send(`/api/v1/ai/risk-assessments/${item.id}/approve`, "POST", {}, "Risk assessment approved.")}>Approve</button></div> : null}
      </li>)}</ul> : <p className="form-help assistant-empty">No risk assessments yet.</p>}
      {canReport ? <form className="form-section" onSubmit={(event) => void addAssessment(event)}>
        <div className="form-grid">
          <div className="field"><label htmlFor="ra-use">Use</label><select id="ra-use" name="use" className="select">{aiUses.map((use) => <option key={use} value={use}>{aiUseLabels[use]}</option>)}</select></div>
          <div className="field"><label htmlFor="ra-review">Review by</label><input id="ra-review" name="reviewDue" type="date" className="input" required /></div>
          <div className="field full"><label htmlFor="ra-title">Title</label><input id="ra-title" name="title" className="input" required minLength={3} maxLength={160} /></div>
          <div className="field full"><label htmlFor="ra-summary">Summary</label><textarea id="ra-summary" name="summary" className="textarea" rows={2} required minLength={20} maxLength={4000} /></div>
          <div className="field full"><label htmlFor="ra-risk">Main risk</label><input id="ra-risk" name="risk" className="input" required minLength={3} maxLength={500} /></div>
          <div className="field"><label htmlFor="ra-likelihood">Likelihood</label><select id="ra-likelihood" name="likelihood" className="select"><option>low</option><option>medium</option><option>high</option></select></div>
          <div className="field"><label htmlFor="ra-impact">Impact</label><select id="ra-impact" name="impact" className="select"><option>low</option><option>medium</option><option>high</option></select></div>
          <div className="field full"><label htmlFor="ra-mitigation">Mitigation</label><input id="ra-mitigation" name="mitigation" className="input" required minLength={3} maxLength={1000} /></div>
        </div>
        <div className="form-actions"><button className="button button-secondary" disabled={busy}>Draft assessment</button></div>
      </form> : null}
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Incidents and corrections</h2><p>Report incorrect or unsupported AI output, privacy or security concerns. An open critical incident suspends AI use for the firm.</p></div></div>
      {data.incidents.length ? <ul className="ai-list">{data.incidents.map((item) => <li key={item.id}>
        <div className="wording-head"><strong>{item.category.replace(/_/g, " ")}</strong><StatusDot tone={severityTone[item.severity as keyof typeof severityTone] ?? "slate"}>{item.severity}</StatusDot><StatusDot tone={item.status === "closed" ? "green" : "amber"}>{item.status}</StatusDot></div>
        <span className="cell-sub">{item.description}</span>
        {item.correctionNote ? <span className="cell-sub">Correction: {item.correctionNote}</span> : null}
        {canManage && item.status !== "closed" ? <div className="row-actions">
          {item.status === "open" ? <button type="button" className="button button-quiet" disabled={busy} onClick={() => void send(`/api/v1/ai/incidents/${item.id}`, "PATCH", { status: "investigating" }, "Marked as investigating.")}>Investigating</button> : null}
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => { const note = window.prompt("What was corrected?"); if (note?.trim()) void send(`/api/v1/ai/incidents/${item.id}`, "PATCH", { status: "closed", correctionNote: note }, "Incident closed."); }}>Close with correction</button>
        </div> : null}
      </li>)}</ul> : <p className="form-help assistant-empty">No incidents reported.</p>}
      {canReport ? <form className="form-section" onSubmit={(event) => void reportIncident(event)}>
        <div className="form-grid">
          <div className="field"><label htmlFor="inc-category">Category</label><select id="inc-category" name="category" className="select">{["incorrect_output", "unsupported_claim", "privacy", "bias", "security", "availability", "other"].map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</select></div>
          <div className="field"><label htmlFor="inc-severity">Severity</label><select id="inc-severity" name="severity" className="select"><option>low</option><option>medium</option><option>high</option><option>critical</option></select></div>
          <div className="field full"><label htmlFor="inc-description">What happened</label><textarea id="inc-description" name="description" className="textarea" rows={2} required minLength={10} maxLength={4000} /></div>
        </div>
        <div className="form-actions"><button className="button button-secondary" disabled={busy}>Report incident</button></div>
      </form> : null}
    </section>
  </div>;
}
