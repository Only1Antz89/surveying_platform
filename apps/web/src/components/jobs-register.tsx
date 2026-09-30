"use client";

import { type FormEvent, useMemo, useState } from "react";
import { Download, Plus, Search, X } from "lucide-react";
import { canTransitionJob, jobStageLabels, jobStages, type JobStage } from "@fieldnote/domain";
import { StatusDot } from "@fieldnote/ui";
import type { Job } from "@/lib/demo-data";
import type { JobFormOptions } from "@/lib/data";

type ApiJob = {
  id: string;
  clientId: string;
  propertyId: string;
  reference: string;
  serviceName: string;
  stage: JobStage;
  assignedSurveyorId: string | null;
  targetDate: string | null;
  fee: string | null;
  priority: "normal" | "high";
  version: number;
};

const tones: Partial<Record<JobStage, "blue" | "green" | "amber" | "slate">> = {
  quoted: "amber",
  instructed: "blue",
  scheduled: "blue",
  inspection_complete: "green",
  report_drafting: "amber",
  internal_review: "blue",
  issued: "green",
  paid: "green",
  archived: "slate",
};

const formatTarget = (value: string | null) => value
  ? new Date(`${value}T12:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })
  : "Not scheduled";

export function JobsRegister({ jobs: initialJobs, options, canEdit = true }: { jobs: Job[]; options: JobFormOptions; canEdit?: boolean }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("All stages");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState(options.clients[0]?.id ?? "");
  const selectableProperties = useMemo(
    () => options.properties.filter((property) => property.clientId === selectedClientId),
    [options.properties, selectedClientId],
  );
  const visible = useMemo(
    () => jobs.filter((job) => `${job.reference} ${job.client} ${job.address} ${job.service}`.toLowerCase().includes(query.toLowerCase()) && (stage === "All stages" || job.stage === stage)),
    [jobs, query, stage],
  );
  const csv = `reference,client,address,service,stage,assignee,target,fee\n${visible.map((job) => [job.reference, job.client, job.address, job.service, job.stage, job.assignee, job.target, job.fee].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n")}`;
  const canCreate = options.clients.length > 0 && options.properties.length > 0;

  async function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const assignedSurveyorId = String(form.get("assignedSurveyorId") || "");
    const targetDate = String(form.get("targetDate") || "");
    const fee = String(form.get("fee") || "");
    const notes = String(form.get("notes") || "");
    const response = await fetch("/api/v1/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: form.get("clientId"),
        propertyId: form.get("propertyId"),
        reference: form.get("reference"),
        serviceName: form.get("serviceName"),
        priority: form.get("priority"),
        assignedSurveyorId: assignedSurveyorId || undefined,
        targetDate: targetDate || undefined,
        fee: fee || undefined,
        notes: notes || undefined,
      }),
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "The job could not be created.");
      return;
    }

    const created = payload.data as ApiJob;
    const client = options.clients.find((item) => item.id === created.clientId);
    const property = options.properties.find((item) => item.id === created.propertyId);
    const surveyor = options.surveyors.find((item) => item.id === created.assignedSurveyorId);
    setJobs((current) => [{
      id: created.id,
      reference: created.reference,
      client: client?.name ?? "Client",
      address: property?.label ?? "Property",
      service: created.serviceName,
      stage: created.stage,
      assignee: surveyor?.name ?? "Unassigned",
      target: formatTarget(created.targetDate),
      fee: Number(created.fee ?? 0),
      priority: created.priority === "high" ? "High" : "Normal",
      version: created.version,
    }, ...current]);
    setCreating(false);
  }

  async function advanceStage(job: Job, nextStage: JobStage) {
    setWorkingId(job.id);
    setError(null);
    const response = await fetch(`/api/v1/jobs/${job.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage: nextStage, version: job.version ?? 1 }) });
    const payload = await response.json();
    setWorkingId(null);
    if (!response.ok) return setError(payload?.error?.message ?? "The job stage could not be changed.");
    setJobs((current) => current.map((item) => item.id === job.id ? { ...item, stage: nextStage, version: payload.data.version } : item));
  }

  return <>
    <section className="panel">
      <div className="toolbar">
        <div className="search"><Search /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reference, client or address" aria-label="Search jobs" /></div>
        <select className="select" value={stage} onChange={(event) => setStage(event.target.value)} aria-label="Job stage"><option>All stages</option>{Object.entries(jobStageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <a className="button button-secondary" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="fieldnote-jobs.csv"><Download size={15} />Export</a>
        <button className="button button-primary" onClick={() => setCreating(true)} disabled={!canCreate || !canEdit}><Plus size={15} />New job</button>
      </div>
      {error && !creating ? <div className="form-section"><p className="form-error" role="alert">{error}</p></div> : null}
      {visible.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Job</th><th>Service</th><th>Stage</th><th>Surveyor</th><th>Target</th><th>Fee</th>{canEdit ? <th>Next stage</th> : null}</tr></thead><tbody>{visible.map((job) => { const nextStages = jobStages.filter((candidate) => canTransitionJob(job.stage, candidate)); return <tr key={job.id}><td data-label="Job"><strong>{job.client}</strong><span className="cell-sub">{job.address}</span><span className="reference">{job.reference}</span></td><td data-label="Service">{job.service}</td><td data-label="Stage"><StatusDot tone={tones[job.stage] ?? "slate"}>{jobStageLabels[job.stage]}</StatusDot></td><td data-label="Surveyor">{job.assignee}</td><td data-label="Target">{job.target}</td><td data-label="Fee">£{job.fee.toLocaleString("en-GB")}</td>{canEdit ? <td data-label="Next stage">{nextStages.length ? <select className="select" aria-label={`Move ${job.reference} to next stage`} value="" disabled={workingId === job.id} onChange={(event) => { if (event.target.value) advanceStage(job, event.target.value as JobStage); }}><option value="">Choose…</option>{nextStages.map((candidate) => <option key={candidate} value={candidate}>{jobStageLabels[candidate]}</option>)}</select> : <span className="cell-sub">Complete</span>}</td> : null}</tr>; })}</tbody></table></div> : <div className="empty-state"><strong>No jobs found</strong><span>{jobs.length ? "Adjust your search or stage filter." : canCreate ? "Create the first job for this workspace." : "Create a client and property before adding a job."}</span></div>}
      <div className="table-footer"><span>Showing {visible.length} of {jobs.length} jobs</span><div className="pager"><button className="active" aria-label="Page 1">1</button></div></div>
    </section>

    {creating ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-job-title">
        <div className="modal-header"><div><h2 id="new-job-title">New job</h2><p>Start a tracked instruction against an existing client and property.</p></div><button className="icon-button" aria-label="Close new job form" onClick={() => setCreating(false)}><X size={16} /></button></div>
        <form onSubmit={createJob}>
          <div className="form-section"><div className="form-grid">
            <div className="field"><label htmlFor="job-client">Client</label><select id="job-client" name="clientId" className="input" value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)} required>{options.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></div>
            <div className="field"><label htmlFor="job-property">Property</label><select key={selectedClientId} id="job-property" name="propertyId" className="input" required>{selectableProperties.length ? selectableProperties.map((property) => <option key={property.id} value={property.id}>{property.label}</option>) : <option value="">No property for this client</option>}</select></div>
            <div className="field"><label htmlFor="job-reference">Reference</label><input id="job-reference" name="reference" className="input" required minLength={3} maxLength={40} autoFocus placeholder="CS-2026-001" /></div>
            <div className="field"><label htmlFor="job-service">Service</label><input id="job-service" name="serviceName" className="input" required minLength={2} maxLength={160} placeholder="Level 2 Home Survey" /></div>
            <div className="field"><label htmlFor="job-priority">Priority</label><select id="job-priority" name="priority" className="input" defaultValue="normal"><option value="normal">Normal</option><option value="high">High</option></select></div>
            <div className="field"><label htmlFor="job-surveyor">Assigned surveyor</label><select id="job-surveyor" name="assignedSurveyorId" className="input" defaultValue=""><option value="">Unassigned</option>{options.surveyors.map((surveyor) => <option key={surveyor.id} value={surveyor.id}>{surveyor.name}</option>)}</select></div>
            <div className="field"><label htmlFor="job-target">Target date</label><input id="job-target" name="targetDate" className="input" type="date" /></div>
            <div className="field"><label htmlFor="job-fee">Fee (£)</label><input id="job-fee" name="fee" className="input" type="number" min="0" step="0.01" inputMode="decimal" /></div>
            <div className="field full"><label htmlFor="job-notes">Internal notes</label><textarea id="job-notes" name="notes" className="input" rows={3} maxLength={5000} /></div>
          </div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="button button-primary" disabled={saving || selectableProperties.length === 0}>{saving ? "Creating…" : "Create job"}</button></div>
        </form>
      </section>
    </div> : null}
  </>;
}
