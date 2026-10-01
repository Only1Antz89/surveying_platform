"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Pencil, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusDot } from "@surveynt/ui";
import type { PlatformIncidentRecord, PlatformQueueRow } from "@/lib/data";
import { PageHeader } from "./page-header";
import { QueueActionButton } from "./queue-action-button";

const statusTone = (status: PlatformIncidentRecord["status"]) => status === "resolved" ? "green" as const : status === "monitoring" ? "blue" as const : "amber" as const;
const severityTone = (severity: PlatformIncidentRecord["severity"]) => severity === "critical" || severity === "high" ? "red" as const : severity === "medium" ? "amber" as const : "slate" as const;
const dateTime = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
const localDateTimeInput = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function IncidentManager({ incidents, tenants, technicalFailures, canManage }: { incidents: PlatformIncidentRecord[]; tenants: { id: string; name: string }[]; technicalFailures: PlatformQueueRow[]; canManage: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlatformIncidentRecord | null>(null);
  const [newStartedAt, setNewStartedAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, method: "POST" | "PATCH", body: unknown) {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message ?? "The incident change could not be completed.");
    router.refresh();
  }

  function incidentBody(form: FormData, includeCreate: boolean) {
    const organisationIds = form.getAll("organisationIds").map(String);
    return { ...(includeCreate ? { title: form.get("title"), severity: form.get("severity"), startedAt: new Date(String(form.get("startedAt"))).toISOString() } : { status: form.get("status") }), summary: form.get("summary"), organisationIds };
  }

  async function createIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    try { await send("/api/platform/incidents", "POST", incidentBody(new FormData(event.currentTarget), true)); setCreating(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The incident could not be created."); }
    finally { setSaving(false); }
  }

  async function updateIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true); setError(null);
    try { await send(`/api/platform/incidents/${editing.id}`, "PATCH", incidentBody(new FormData(event.currentTarget), false)); setEditing(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The incident could not be updated."); }
    finally { setSaving(false); }
  }

  return <main className="page"><PageHeader eyebrow="Platform operations" title="Incidents" description="Coordinate security, availability and data incidents with accountable ownership." actions={canManage ? <button className="button button-primary" onClick={() => { setError(null); setNewStartedAt(localDateTimeInput(new Date())); setCreating(true); }}><Plus size={15} />Log incident</button> : undefined} />
    {error && !creating && !editing ? <div className="support-banner" role="alert">{error}</div> : null}
    <div className="stack"><section className="panel"><div className="panel-header"><div><h2>Incident register</h2><p>Declared operational incidents and their affected customer accounts</p></div><AlertTriangle size={17} color="#3b82f6" /></div>{incidents.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Incident</th><th>Severity</th><th>Status</th><th>Affected tenants</th><th>Started</th>{canManage ? <th>Action</th> : null}</tr></thead><tbody>{incidents.map((incident) => <tr key={incident.id}><td data-label="Incident"><strong>{incident.title}</strong><span className="cell-sub">{incident.summary}</span></td><td data-label="Severity"><StatusDot tone={severityTone(incident.severity)}>{incident.severity}</StatusDot></td><td data-label="Status"><StatusDot tone={statusTone(incident.status)}>{incident.status}</StatusDot></td><td data-label="Affected tenants">{incident.affectedOrganisations.length ? <div className="tenant-chip-list">{incident.affectedOrganisations.map((tenant) => <Link key={tenant.id} href={`/platform/tenants/${tenant.id}`}>{tenant.name}</Link>)}</div> : <span className="cell-sub">Platform-wide / none specified</span>}</td><td data-label="Started">{dateTime(incident.startedAt)}</td>{canManage ? <td data-label="Action"><button className="button button-quiet" onClick={() => { setError(null); setEditing(incident); }}><Pencil size={14} />Manage</button></td> : null}</tr>)}</tbody></table></div> : <div className="empty-state compact"><CheckCircle2 size={27} color="#15825e" /><strong>No declared incidents</strong><span>Log an incident when coordinated customer communication and resolution tracking are required.</span></div>}</section>
      <section className="panel"><div className="panel-header"><div><h2>Technical failures</h2><p>Failed background work and provider webhooks requiring operator attention</p></div></div>{technicalFailures.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Failure</th><th>Status</th><th>Detail</th><th>Action</th></tr></thead><tbody>{technicalFailures.map((row) => <tr key={row.id}><td data-label="Failure"><strong>{row.primary}</strong><span className="cell-sub">{row.secondary}</span></td><td data-label="Status"><StatusDot tone={row.tone ?? "red"}>{row.state}</StatusDot></td><td data-label="Detail">{row.detail}</td><td data-label="Action">{row.actionEndpoint && row.action ? <QueueActionButton endpoint={row.actionEndpoint} label={row.action} /> : <span className="cell-sub">Investigate provider event</span>}</td></tr>)}</tbody></table></div> : <div className="empty-state compact"><CheckCircle2 size={27} color="#15825e" /><strong>Technical queue clear</strong><span>No failed jobs or integrations currently require attention.</span></div>}</section></div>

    {creating ? <IncidentModal title="Log incident" description="Declare an incident and identify affected customer accounts." tenants={tenants} startedAt={newStartedAt} saving={saving} error={error} onClose={() => setCreating(false)} onSubmit={createIncident} /> : null}
    {editing ? <IncidentModal title={editing.title} description="Update status, customer impact and the current operator summary." tenants={tenants} incident={editing} saving={saving} error={error} onClose={() => setEditing(null)} onSubmit={updateIncident} /> : null}
  </main>;
}

function IncidentModal({ title, description, tenants, incident, startedAt, saving, error, onClose, onSubmit }: { title: string; description: string; tenants: { id: string; name: string }[]; incident?: PlatformIncidentRecord; startedAt?: string; saving: boolean; error: string | null; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const localStarted = incident ? localDateTimeInput(new Date(incident.startedAt)) : startedAt;
  const affected = new Set(incident?.affectedOrganisations.map((tenant) => tenant.id) ?? []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal incident-modal" role="dialog" aria-modal="true" aria-labelledby="incident-modal-title"><div className="modal-header"><div><h2 id="incident-modal-title">{title}</h2><p>{description}</p></div><button className="icon-button" aria-label="Close incident form" onClick={onClose}><X size={16} /></button></div><form onSubmit={onSubmit}><div className="form-section"><div className="form-grid">{incident ? <div className="field full"><label htmlFor="incident-status">Status</label><select id="incident-status" name="status" className="input" defaultValue={incident.status}><option value="investigating">Investigating</option><option value="monitoring">Monitoring</option><option value="resolved">Resolved</option></select></div> : <><div className="field full"><label htmlFor="incident-title">Title</label><input id="incident-title" name="title" className="input" required minLength={3} maxLength={180} autoFocus /></div><div className="field"><label htmlFor="incident-severity">Severity</label><select id="incident-severity" name="severity" className="input" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div><div className="field"><label htmlFor="incident-started">Started</label><input id="incident-started" name="startedAt" className="input" type="datetime-local" defaultValue={localStarted} required /></div></>}<div className="field full"><label htmlFor="incident-summary">Operator summary</label><textarea id="incident-summary" name="summary" className="input" rows={5} defaultValue={incident?.summary ?? ""} required minLength={10} maxLength={5000} /></div><fieldset className="tenant-picker field full"><legend>Affected tenants</legend>{tenants.length ? tenants.map((tenant) => <label key={tenant.id}><input type="checkbox" name="organisationIds" value={tenant.id} defaultChecked={affected.has(tenant.id)} /><span>{tenant.name}</span></label>) : <p>No customer accounts are available.</p>}</fieldset></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : incident ? "Save incident" : "Log incident"}</button></div></form></section></div>;
}
