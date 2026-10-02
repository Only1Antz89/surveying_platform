"use client";

import { type FormEvent, useMemo, useState } from "react";
import { Check, FilePlus2, Pencil, Search, Trash2, X } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { clausePurposeLabels, clausePurposes, conditionRatings, inspectionStatusLabels, inspectionStatuses, nextActionLabels, nextActions, serviceLevelLabels, serviceLevels, type ClausePurpose } from "@surveynt/assistant";
import { ukCountries, ukCountryLabels } from "@surveynt/domain";

export type LibraryClause = {
  id: string; clauseKey: string; version: number; status: "draft" | "approved" | "retired"; purpose: ClausePurpose; title: string; body: string; elementKey: string | null;
  conditionRatings: string[]; nextActions: string[]; inspectionStatuses: string[]; jurisdictions: string[]; serviceLevels: string[]; source: string; licenceReference: string | null;
  approvedAt: string | null; retiredAt: string | null; createdAt: string;
};

type Editing = { mode: "create" | "edit" | "version"; clause: Partial<LibraryClause> };

const statusTone = { draft: "amber", approved: "green", retired: "slate" } as const;

/**
 * The firm's wording library. Surveyors write drafts; owners and
 * administrators approve them. Approved wording never changes: a new version
 * supersedes it, and earlier versions stay on record for issued reports.
 */
export function WordingLibrary({ clauses: initial, elements, canAuthor, canApprove, demo }: { clauses: LibraryClause[]; elements: { key: string; label: string }[]; canAuthor: boolean; canApprove: boolean; demo: boolean }) {
  const [clauses, setClauses] = useState(initial);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const elementLabel = useMemo(() => new Map(elements.map((element) => [element.key, element.label])), [elements]);
  const groups = useMemo(() => {
    const byKey = new Map<string, LibraryClause[]>();
    for (const clause of clauses) byKey.set(clause.clauseKey, [...(byKey.get(clause.clauseKey) ?? []), clause]);
    return [...byKey.entries()].map(([key, versions]) => ({ key, versions: versions.sort((a, b) => b.version - a.version) }))
      .filter((group) => `${group.key} ${group.versions.map((version) => `${version.title} ${version.body}`).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  }, [clauses, query]);

  async function refresh() {
    const response = await fetch("/api/v1/wording-clauses", { cache: "no-store" });
    if (response.ok) setClauses((await response.json()).data);
  }

  async function call(url: string, init: RequestInit, done: string) {
    setBusy(true); setMessage(null);
    const response = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      const fieldErrors = payload?.error?.details?.fieldErrors as Record<string, string[]> | undefined;
      setMessage({ tone: "error", text: [payload?.error?.message ?? "The change failed.", ...Object.values(fieldErrors ?? {}).flat()].join(" ") });
      return false;
    }
    setMessage({ tone: "success", text: payload?.meta?.demo ? "Demo workspace: nothing was saved." : done });
    await refresh();
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const list = (name: string) => form.getAll(name).map(String);
    const body = {
      clauseKey: String(form.get("clauseKey") ?? editing.clause.clauseKey ?? ""), purpose: String(form.get("purpose")), title: String(form.get("title")), body: String(form.get("body")),
      elementKey: String(form.get("elementKey") ?? "") || null, conditionRatings: list("conditionRatings"), nextActions: list("nextActions"), inspectionStatuses: list("inspectionStatuses"),
      jurisdictions: list("jurisdictions"), serviceLevels: list("serviceLevels"), source: String(form.get("source")), licenceReference: String(form.get("licenceReference") ?? "").trim() || null,
    };
    const ok = editing.mode === "edit"
      ? await call(`/api/v1/wording-clauses/${editing.clause.id}`, { method: "PATCH", body: JSON.stringify({ ...body, clauseKey: undefined }) }, "Draft saved.")
      : await call("/api/v1/wording-clauses", { method: "POST", body: JSON.stringify(body) }, editing.mode === "version" ? "New draft version created." : "Draft created.");
    if (ok) setEditing(null);
  }

  const clause = editing?.clause ?? {};
  const checkboxes = (name: string, values: readonly string[], labels: (value: string) => string, selected: string[] | undefined) => <div className="check-row">{values.map((value) => <label key={value} className="check-field"><input type="checkbox" name={name} value={value} defaultChecked={selected?.includes(value)} />{labels(value)}</label>)}</div>;

  return <>
    {demo ? <p className="address-demo-label">Demo workspace: invented wording; changes are not saved.</p> : null}
    {message ? <p className={message.tone === "error" ? "form-error" : "form-success"} role="status">{message.text}</p> : null}
    <section className="panel">
      <div className="toolbar">
        <div className="search"><Search /><input className="input" placeholder="Search wording" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search wording" /></div>
        {canAuthor ? <button type="button" className="button button-primary" onClick={() => setEditing({ mode: "create", clause: { purpose: "element_narrative", source: "firm_authored" } })}><FilePlus2 size={14} />New clause</button> : null}
      </div>
      {groups.length ? <ul className="wording-list">{groups.map((group) => {
        const current = group.versions.find((version) => version.status === "approved");
        const draft = group.versions.find((version) => version.status === "draft");
        const shown = draft ?? current ?? group.versions[0];
        return <li key={group.key}>
          <div className="wording-head"><strong>{shown.title}</strong><span className="reference">{group.key}</span><StatusDot tone={statusTone[shown.status]}>{shown.status === "approved" ? `Approved v${shown.version}` : shown.status === "draft" ? `Draft v${shown.version}` : `Retired v${shown.version}`}</StatusDot>{draft && current ? <span className="cell-sub">Approved v{current.version} in use until this draft is approved</span> : null}</div>
          <p className="wording-body">{shown.body}</p>
          <span className="cell-sub">{clausePurposeLabels[shown.purpose]} · {shown.elementKey ? elementLabel.get(shown.elementKey) ?? shown.elementKey : "Any element"}{shown.conditionRatings.length ? ` · ratings ${shown.conditionRatings.join(", ")}` : ""}{shown.nextActions.length ? ` · ${shown.nextActions.map((action) => nextActionLabels[action as keyof typeof nextActionLabels] ?? action).join(", ")}` : ""}{shown.inspectionStatuses.length ? ` · ${shown.inspectionStatuses.map((status) => inspectionStatusLabels[status as keyof typeof inspectionStatusLabels] ?? status).join(", ")}` : ""}{shown.jurisdictions.length ? ` · ${shown.jurisdictions.join(", ")}` : ""}{shown.source === "licensed_third_party" ? ` · licensed (${shown.licenceReference})` : ""}</span>
          <div className="row-actions">
            {draft && canAuthor ? <button type="button" className="button button-quiet" disabled={busy} onClick={() => setEditing({ mode: "edit", clause: draft })}><Pencil size={14} />Edit draft</button> : null}
            {draft && canApprove ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => { if (window.confirm(`Approve "${draft.title}" v${draft.version}? It will be used in new reports${current ? ` instead of v${current.version}` : ""}.`)) void call(`/api/v1/wording-clauses/${draft.id}/approve`, { method: "POST" }, "Approved."); }}><Check size={14} />Approve</button> : null}
            {draft && canAuthor ? <button type="button" className="button button-quiet danger" disabled={busy} onClick={() => { if (window.confirm("Delete this draft?")) void call(`/api/v1/wording-clauses/${draft.id}`, { method: "DELETE" }, "Draft deleted."); }}><Trash2 size={14} />Delete draft</button> : null}
            {!draft && current && canAuthor ? <button type="button" className="button button-quiet" disabled={busy} onClick={() => setEditing({ mode: "version", clause: { ...current, id: undefined } })}><Pencil size={14} />New version</button> : null}
            {!draft && current && canApprove ? <button type="button" className="button button-quiet danger" disabled={busy} onClick={() => { if (window.confirm(`Retire "${current.title}"? It stops appearing in new reports; issued reports keep it.`)) void call(`/api/v1/wording-clauses/${current.id}`, { method: "DELETE" }, "Retired."); }}>Retire</button> : null}
          </div>
          {group.versions.length > 1 ? <details className="wording-history"><summary>{group.versions.length} versions</summary><ul>{group.versions.map((version) => <li key={version.id}>v{version.version} · {version.status}{version.approvedAt ? ` · approved ${new Date(version.approvedAt).toLocaleDateString("en-GB")}` : ""}{version.retiredAt ? ` · retired ${new Date(version.retiredAt).toLocaleDateString("en-GB")}` : ""}</li>)}</ul></details> : null}
        </li>;
      })}</ul> : <div className="empty-state"><strong>No wording yet</strong><span>Write the firm&apos;s own clauses. Reports use approved clauses only, alongside the surveyor&apos;s recorded findings.</span></div>}
    </section>
    {editing ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
      <section className="modal wording-modal" role="dialog" aria-modal="true" aria-labelledby="wording-title">
        <div className="modal-header"><div><h2 id="wording-title">{editing.mode === "edit" ? "Edit draft" : editing.mode === "version" ? `New version of ${clause.clauseKey}` : "New clause"}</h2><p>Placeholders: {"{element}"}, {"{location}"}, {"{next_action}"}, {"{rating}"}. A clause is skipped, never half-filled, when a placeholder has no value.</p></div><button className="icon-button" aria-label="Close" onClick={() => setEditing(null)}><X size={16} /></button></div>
        <form onSubmit={submit} className="form-section">
          <div className="form-grid">
            <div className="field"><label htmlFor="clause-key">Clause key</label><input id="clause-key" name="clauseKey" className="input" required defaultValue={clause.clauseKey} disabled={editing.mode !== "create"} pattern="[a-z0-9][a-z0-9_.\-]{1,80}" placeholder="roof.serious-defect" /></div>
            <div className="field"><label htmlFor="clause-purpose">Purpose</label><select id="clause-purpose" name="purpose" className="select" defaultValue={clause.purpose}>{clausePurposes.map((purpose) => <option key={purpose} value={purpose}>{clausePurposeLabels[purpose]}</option>)}</select></div>
            <div className="field full"><label htmlFor="clause-title">Title</label><input id="clause-title" name="title" className="input" required minLength={3} maxLength={160} defaultValue={clause.title} /></div>
            <div className="field full"><label htmlFor="clause-body">Wording</label><textarea id="clause-body" name="body" className="textarea" required minLength={10} maxLength={4000} rows={4} defaultValue={clause.body} /></div>
            <div className="field"><label htmlFor="clause-element">Element</label><select id="clause-element" name="elementKey" className="select" defaultValue={clause.elementKey ?? ""}><option value="">Any element</option>{elements.map((element) => <option key={element.key} value={element.key}>{element.label}</option>)}</select></div>
            <div className="field"><label htmlFor="clause-source">Source</label><select id="clause-source" name="source" className="select" defaultValue={clause.source ?? "firm_authored"}><option value="firm_authored">Written by the firm</option><option value="licensed_third_party">Licensed third-party wording</option></select></div>
            <div className="field full"><label htmlFor="clause-licence">Licence reference (licensed wording only)</label><input id="clause-licence" name="licenceReference" className="input" maxLength={300} defaultValue={clause.licenceReference ?? ""} /></div>
            <fieldset className="field full"><legend>Condition ratings (none = any)</legend>{checkboxes("conditionRatings", conditionRatings, (value) => value, clause.conditionRatings)}</fieldset>
            <fieldset className="field full"><legend>Next actions (none = any)</legend>{checkboxes("nextActions", nextActions, (value) => nextActionLabels[value as keyof typeof nextActionLabels], clause.nextActions)}</fieldset>
            <fieldset className="field full"><legend>Inspection statuses (limitation clauses)</legend>{checkboxes("inspectionStatuses", inspectionStatuses, (value) => inspectionStatusLabels[value as keyof typeof inspectionStatusLabels], clause.inspectionStatuses)}</fieldset>
            <fieldset className="field full"><legend>Jurisdictions (none = all)</legend>{checkboxes("jurisdictions", ukCountries, (value) => ukCountryLabels[value as keyof typeof ukCountryLabels], clause.jurisdictions)}</fieldset>
            <fieldset className="field full"><legend>Service scopes (none = all)</legend>{checkboxes("serviceLevels", serviceLevels, (value) => serviceLevelLabels[value as keyof typeof serviceLevelLabels], clause.serviceLevels)}</fieldset>
          </div>
          <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save draft"}</button></div>
        </form>
      </section>
    </div> : null}
  </>;
}
