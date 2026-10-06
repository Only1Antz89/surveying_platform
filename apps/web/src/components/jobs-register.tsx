"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, Clock3, Download, Eye, Pencil, Plus, Search, X } from "lucide-react";
import { canTransitionJob, jobStageLabels, jobStages, type JobStage } from "@surveynt/domain";
import { StatusDot } from "@surveynt/ui";
import type { Job } from "@/lib/demo-data";
import type { JobFormOptions } from "@/lib/data";
import type { CompletionOverride } from "@surveynt/assistant";
import { JobAiConsent } from "./job-ai-consent";
import { StageGateDialog, type StageGateDetails } from "./stage-gate-dialog";

type ApiJob = {
  id: string; clientId: string; propertyId: string; reference: string; serviceName: string; stage: JobStage;
  assignedSurveyorId: string | null; coordinatorId?: string | null; targetDate: string | null;
  fee: string | null; notes?: string | null; priority: "normal" | "high"; version: number;
};

type JobDetail = {
  job: ApiJob;
  stageHistory: Array<{ id: string; fromStage: JobStage | null; toStage: JobStage; reason: string | null; changedBy: string; createdAt: string }>;
};

const tones: Partial<Record<JobStage, "blue" | "green" | "amber" | "slate">> = {
  quoted: "amber", instructed: "blue", scheduled: "blue", inspection_complete: "green",
  report_drafting: "amber", internal_review: "blue", issued: "green", paid: "green", archived: "slate",
};

const formatTarget = (value: string | null) => value
  ? new Date(`${value}T12:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })
  : "Not scheduled";
const formatDateTime = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });

export function JobsRegister({ slug, jobs: initialJobs, options, canEdit = true, showFinance = true,initialSelectedId }: { slug: string; jobs: Job[]; options: JobFormOptions; canEdit?: boolean; showFinance?: boolean;initialSelectedId?:string }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("All stages");
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(()=>{if(!initialSelectedId)return;let active=true;fetch(`/api/v1/jobs/${initialSelectedId}`).then(async r=>{const p=await r.json();if(!r.ok)throw new Error(p.error?.message??"Job could not be opened.");if(active)setDetail(p.data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[initialSelectedId]);
  // A stage change refused by the survey's completion checks, waiting for fixes or recorded reasons.
  const [gate, setGate] = useState<{ jobId: string; body: Record<string, unknown>; details: StageGateDetails; message: string; onDone: (data: ApiJob) => Promise<void> | void } | null>(null);
  const [gateBusy, setGateBusy] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState(options.clients[0]?.id ?? "");
  const selectableProperties = useMemo(() => options.properties.filter((property) => property.clientId === selectedClientId), [options.properties, selectedClientId]);
  const visible = useMemo(() => jobs.filter((job) => `${job.reference} ${job.client} ${job.address} ${job.service}`.toLowerCase().includes(query.toLowerCase()) && (stage === "All stages" || job.stage === stage)), [jobs, query, stage]);
  const csv = `reference,client,address,service,stage,assignee,target${showFinance ? ",fee" : ""}\n${visible.map((job) => [job.reference, job.client, job.address, job.service, job.stage, job.assignee, job.target, ...(showFinance ? [job.fee] : [])].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n")}`;
  const canCreate = options.clients.length > 0 && options.properties.length > 0;

  async function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    const form = new FormData(event.currentTarget);
    const optional = (name: string) => String(form.get(name) || "") || undefined;
    const response = await fetch("/api/v1/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: form.get("clientId"), propertyId: form.get("propertyId"), reference: form.get("reference"), serviceName: form.get("serviceName"), priority: form.get("priority"), assignedSurveyorId: optional("assignedSurveyorId"), coordinatorId: optional("coordinatorId"), targetDate: optional("targetDate"), fee: optional("fee"), notes: optional("notes") }) });
    const payload = await response.json(); setSaving(false);
    if (!response.ok) return setError(payload?.error?.message ?? "The job could not be created.");
    const created = payload.data as ApiJob;
    const client = options.clients.find((item) => item.id === created.clientId);
    const property = options.properties.find((item) => item.id === created.propertyId);
    const surveyor = options.surveyors.find((item) => item.id === created.assignedSurveyorId);
    setJobs((current) => [{ id: created.id, reference: created.reference, client: client?.name ?? "Client", address: property?.label ?? "Property", service: created.serviceName, stage: created.stage, assignee: surveyor?.name ?? "Unassigned", target: formatTarget(created.targetDate), fee: Number(created.fee ?? 0), priority: created.priority === "high" ? "High" : "Normal", version: created.version }, ...current]);
    setCreating(false);
  }

  async function loadDetail(job: Job) {
    setDetailLoading(true); setError(null); setDetail(null);
    const response = await fetch(`/api/v1/jobs/${job.id}`);
    const payload = await response.json(); setDetailLoading(false);
    if (!response.ok) return setError(payload?.error?.message ?? "The job record could not be opened.");
    setDetail(payload.data as JobDetail);
  }

  /** PATCHes a job; a completion-check refusal opens the stage gate dialog instead of a plain error. */
  async function patchJob(jobId: string, body: Record<string, unknown>, onDone: (data: ApiJob) => Promise<void> | void, fallback: string) {
    const response = await fetch(`/api/v1/jobs/${jobId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => null);
    if (response.ok) { setGate(null); await onDone(payload.data as ApiJob); return; }
    if (response.status === 422 && payload?.error?.code === "completion_checks_failed") { setGate({ jobId, body, details: payload.error.details as StageGateDetails, message: payload.error.message, onDone }); return; }
    setGate(null);
    setError(payload?.error?.message ?? fallback);
  }

  async function advanceStage(job: Job, nextStage: JobStage) {
    setWorkingId(job.id); setError(null);
    await patchJob(job.id, { stage: nextStage, version: job.version ?? 1 }, (data) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, stage: nextStage, version: data.version } : item)), "The job stage could not be changed.");
    setWorkingId(null);
  }

  async function submitOverrides(overrides: CompletionOverride[]) {
    if (!gate) return;
    setGateBusy(true);
    await patchJob(gate.jobId, { ...gate.body, completionOverrides: overrides }, gate.onDone, "The job stage could not be changed.");
    setGateBusy(false);
  }

  async function updateJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setSaving(true); setError(null);
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) || "");
    const nextStage = value("stage") as JobStage;
    const body: Record<string, string | number | null> = {
      serviceName: value("serviceName"), priority: value("priority"), assigneeId: value("assigneeId") || null,
      coordinatorId: value("coordinatorId") || null, targetDate: value("targetDate") || null,
      fee: value("fee") || null, notes: value("notes") || null, version: detail.job.version,
    };
    if (nextStage !== detail.job.stage) body.stage = nextStage;
    await patchJob(detail.job.id, body, async (updated) => {
      const surveyor = options.surveyors.find((item) => item.id === updated.assignedSurveyorId);
      setJobs((current) => current.map((item) => item.id === updated.id ? { ...item, service: updated.serviceName, stage: updated.stage, assignee: surveyor?.name ?? "Unassigned", target: formatTarget(updated.targetDate), fee: Number(updated.fee ?? 0), priority: updated.priority === "high" ? "High" : "Normal", version: updated.version } : item));
      await loadDetail({ ...jobs.find((item) => item.id === updated.id)!, version: updated.version });
    }, "The job could not be updated.");
    setSaving(false);
  }

  const closeDetail = () => { setDetail(null); setDetailLoading(false); setError(null); };

  return <>
    <section className="panel">
      <div className="toolbar">
        <div className="search"><Search /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reference, client or address" aria-label="Search jobs" /></div>
        <select className="select" value={stage} onChange={(event) => setStage(event.target.value)} aria-label="Job stage"><option>All stages</option>{Object.entries(jobStageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <a className="button button-secondary" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="surveynt-jobs.csv"><Download size={15} />Export</a>
        <button className="button button-primary" onClick={() => { setError(null); setCreating(true); }} disabled={!canCreate || !canEdit}><Plus size={15} />New job</button>
      </div>
      {error && !creating && !detail && !detailLoading ? <div className="form-section"><p className="form-error" role="alert">{error}</p></div> : null}
      {visible.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Job</th><th>Service</th><th>Stage</th><th>Surveyor</th><th>Target</th>{showFinance ? <th>Fee</th> : null}{canEdit ? <th>Next stage</th> : null}<th>Record</th></tr></thead><tbody>{visible.map((job) => { const nextStages = jobStages.filter((candidate) => canTransitionJob(job.stage, candidate)); return <tr key={job.id}><td data-label="Job"><button className="table-link-button" onClick={() => loadDetail(job)}><strong>{job.client}</strong><span className="cell-sub">{job.address}</span><span className="reference">{job.reference}</span></button></td><td data-label="Service">{job.service}</td><td data-label="Stage"><StatusDot tone={tones[job.stage] ?? "slate"}>{jobStageLabels[job.stage]}</StatusDot></td><td data-label="Surveyor">{job.assignee}</td><td data-label="Target">{job.target}</td>{showFinance ? <td data-label="Fee">£{(job.fee ?? 0).toLocaleString("en-GB")}</td> : null}{canEdit ? <td data-label="Next stage">{nextStages.length ? <select className="select" aria-label={`Move ${job.reference} to next stage`} value="" disabled={workingId === job.id} onChange={(event) => { if (event.target.value) advanceStage(job, event.target.value as JobStage); }}><option value="">Choose…</option>{nextStages.map((candidate) => <option key={candidate} value={candidate}>{jobStageLabels[candidate]}</option>)}</select> : <span className="cell-sub">Complete</span>}</td> : null}<td data-label="Record"><Link className="button button-primary" href={`/app/${slug}/jobs/${job.id}/survey`}><ClipboardList size={14} />Open survey</Link><Link className="button button-quiet" href={`/app/${slug}/jobs/${job.id}`}>Job details</Link><button className="button button-quiet" onClick={() => loadDetail(job)}><Eye size={14} />View</button></td></tr>; })}</tbody></table></div> : <div className="empty-state"><strong>No jobs found</strong><span>{jobs.length ? "Adjust your search or stage filter." : canCreate ? "Create the first job for this workspace." : "Create a client and property before adding a job."}</span></div>}
      <div className="table-footer"><span>Showing {visible.length} of {jobs.length} jobs</span><div className="pager"><button className="active" aria-label="Page 1">1</button></div></div>
    </section>

    {creating ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-job-title"><div className="modal-header"><div><h2 id="new-job-title">New job</h2><p>Start a tracked instruction against an existing client and property.</p></div><button className="icon-button" aria-label="Close new job form" onClick={() => setCreating(false)}><X size={16} /></button></div><form onSubmit={createJob}><div className="form-section"><div className="form-grid">
      <div className="field"><label htmlFor="job-client">Client</label><select id="job-client" name="clientId" className="input" value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)} required>{options.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></div>
      <div className="field"><label htmlFor="job-property">Property</label><select key={selectedClientId} id="job-property" name="propertyId" className="input" required>{selectableProperties.length ? selectableProperties.map((property) => <option key={property.id} value={property.id}>{property.label}</option>) : <option value="">No property for this client</option>}</select></div>
      <div className="field"><label htmlFor="job-reference">Reference</label><input id="job-reference" name="reference" className="input" required minLength={3} maxLength={40} autoFocus placeholder="CS-2026-001" /></div>
      <div className="field"><label htmlFor="job-service">Service</label><input id="job-service" name="serviceName" className="input" required minLength={2} maxLength={160} placeholder="Level 2 Home Survey" /></div>
      <div className="field"><label htmlFor="job-priority">Priority</label><select id="job-priority" name="priority" className="input" defaultValue="normal"><option value="normal">Normal</option><option value="high">High</option></select></div>
      <div className="field"><label htmlFor="job-surveyor">Assigned surveyor</label><select id="job-surveyor" name="assignedSurveyorId" className="input" defaultValue=""><option value="">Unassigned</option>{options.surveyors.map((surveyor) => <option key={surveyor.id} value={surveyor.id}>{surveyor.name}</option>)}</select></div>
      <div className="field"><label htmlFor="job-coordinator">Coordinator</label><select id="job-coordinator" name="coordinatorId" className="input" defaultValue=""><option value="">Unassigned</option>{options.coordinators.map((coordinator) => <option key={coordinator.id} value={coordinator.id}>{coordinator.name}</option>)}</select></div>
      <div className="field"><label htmlFor="job-target">Target date</label><input id="job-target" name="targetDate" className="input" type="date" /></div>
      <div className="field"><label htmlFor="job-fee">Fee (£)</label><input id="job-fee" name="fee" className="input" type="number" min="0" step="0.01" inputMode="decimal" /></div>
      <div className="field full"><label htmlFor="job-notes">Internal notes</label><textarea id="job-notes" name="notes" className="input" rows={3} maxLength={5000} /></div>
    </div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="button button-primary" disabled={saving || selectableProperties.length === 0}>{saving ? "Creating…" : "Create job"}</button></div></form></section></div> : null}

    {detailLoading ? <div className="modal-backdrop"><section className="modal job-record-modal" role="dialog" aria-modal="true" aria-label="Loading job record"><div className="job-loading"><Clock3 size={18} />Loading job record…</div></section></div> : null}
    {detail ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}><section className="modal job-record-modal" role="dialog" aria-modal="true" aria-labelledby="job-record-title"><div className="modal-header"><div><span className="eyebrow">{detail.job.reference}</span><h2 id="job-record-title">Job record</h2><p>Operational details and permanent stage history.</p></div><button className="icon-button" aria-label="Close job record" onClick={closeDetail}><X size={16} /></button></div><form onSubmit={updateJob}><div className="job-record-layout"><div className="form-section"><div className="form-grid">
      <div className="field full"><label htmlFor="edit-job-service">Service</label><input id="edit-job-service" name="serviceName" className="input" defaultValue={detail.job.serviceName} required minLength={2} maxLength={160} disabled={!canEdit} /></div>
      <div className="field"><label htmlFor="edit-job-stage">Stage</label><select id="edit-job-stage" name="stage" className="input" defaultValue={detail.job.stage} disabled={!canEdit}><option value={detail.job.stage}>{jobStageLabels[detail.job.stage]}</option>{jobStages.filter((candidate) => canTransitionJob(detail.job.stage, candidate)).map((candidate) => <option key={candidate} value={candidate}>{jobStageLabels[candidate]}</option>)}</select></div>
      <div className="field"><label htmlFor="edit-job-priority">Priority</label><select id="edit-job-priority" name="priority" className="input" defaultValue={detail.job.priority} disabled={!canEdit}><option value="normal">Normal</option><option value="high">High</option></select></div>
      <div className="field"><label htmlFor="edit-job-surveyor">Assigned surveyor</label><select id="edit-job-surveyor" name="assigneeId" className="input" defaultValue={detail.job.assignedSurveyorId ?? ""} disabled={!canEdit}><option value="">Unassigned</option>{options.surveyors.map((surveyor) => <option key={surveyor.id} value={surveyor.id}>{surveyor.name}</option>)}</select></div>
      <div className="field"><label htmlFor="edit-job-coordinator">Coordinator</label><select id="edit-job-coordinator" name="coordinatorId" className="input" defaultValue={detail.job.coordinatorId ?? ""} disabled={!canEdit}><option value="">Unassigned</option>{options.coordinators.map((coordinator) => <option key={coordinator.id} value={coordinator.id}>{coordinator.name}</option>)}</select></div>
      <div className="field"><label htmlFor="edit-job-target">Target date</label><input id="edit-job-target" name="targetDate" className="input" type="date" defaultValue={detail.job.targetDate ?? ""} disabled={!canEdit} /></div>
      <div className="field"><label htmlFor="edit-job-fee">Fee (£)</label><input id="edit-job-fee" name="fee" className="input" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={detail.job.fee ?? ""} disabled={!canEdit} /></div>
      <div className="field full"><label htmlFor="edit-job-notes">Internal notes</label><textarea id="edit-job-notes" name="notes" className="input" rows={5} maxLength={5000} defaultValue={detail.job.notes ?? ""} disabled={!canEdit} /></div>
    </div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><aside className="job-history" aria-label="Stage history"><div className="job-history-heading"><Clock3 size={16} /><div><h3>Stage history</h3><p>{detail.stageHistory.length} recorded {detail.stageHistory.length === 1 ? "event" : "events"}</p></div></div>{detail.stageHistory.length ? <ol>{[...detail.stageHistory].reverse().map((event) => <li key={event.id}><i aria-hidden="true" /><div><strong>{jobStageLabels[event.toStage]}</strong><span>{event.reason || (event.fromStage ? `Moved from ${jobStageLabels[event.fromStage]}` : "Stage recorded")}</span><small>{event.changedBy} · {formatDateTime(event.createdAt)}</small></div></li>)}</ol> : <p className="job-history-empty">No stage events have been recorded.</p>}<JobAiConsent key={detail.job.id} jobId={detail.job.id} canEdit={canEdit} /></aside></div>{canEdit ? <div className="modal-actions"><button type="button" className="button button-secondary" onClick={closeDetail}>Close</button><Link className="button button-secondary" href={`/app/${slug}/jobs/${detail.job.id}/survey`}><ClipboardList size={14} />Open survey</Link><button className="button button-primary" disabled={saving}><Pencil size={14} />{saving ? "Saving…" : "Save changes"}</button></div> : <div className="modal-actions"><button type="button" className="button button-secondary" onClick={closeDetail}>Close</button><Link className="button button-secondary" href={`/app/${slug}/jobs/${detail.job.id}/survey`}><ClipboardList size={14} />Open survey</Link></div>}</form></section></div> : null}
    {gate ? <StageGateDialog details={gate.details} message={gate.message} surveyHref={`/app/${slug}/jobs/${gate.jobId}/survey`} busy={gateBusy} onSubmit={(overrides) => void submitOverrides(overrides)} onClose={() => setGate(null)} /> : null}
  </>;
}
