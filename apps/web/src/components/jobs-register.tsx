"use client";

import { useMemo, useState } from "react";
import { Download, Plus, Search } from "lucide-react";
import { jobStageLabels, type JobStage } from "@fieldnote/domain";
import { StatusDot } from "@fieldnote/ui";
import type { Job } from "@/lib/demo-data";
import { ActionButton } from "./action-feedback";

const tones: Partial<Record<JobStage, "blue" | "green" | "amber" | "slate">> = { quoted: "amber", instructed: "blue", scheduled: "blue", inspection_complete: "green", report_drafting: "amber", internal_review: "blue", issued: "green", paid: "green", archived: "slate" };

export function JobsRegister({ jobs }: { jobs: Job[] }) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("All stages");
  const visible = useMemo(() => jobs.filter((job) => `${job.reference} ${job.client} ${job.address} ${job.service}`.toLowerCase().includes(query.toLowerCase()) && (stage === "All stages" || job.stage === stage)), [jobs, query, stage]);
  const csv = `reference,client,address,service,stage,assignee,target,fee\n${visible.map((job) => [job.reference, job.client, job.address, job.service, job.stage, job.assignee, job.target, job.fee].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n")}`;
  return <section className="panel">
    <div className="toolbar"><div className="search"><Search /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reference, client or address" aria-label="Search jobs" /></div><select className="select" value={stage} onChange={(event) => setStage(event.target.value)} aria-label="Job stage"><option>All stages</option>{Object.entries(jobStageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><a className="button button-secondary" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="fieldnote-jobs.csv"><Download size={15} />Export</a><ActionButton className="button button-primary" message="Job creation flow opened"><Plus size={15} />New job</ActionButton></div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Job</th><th>Service</th><th>Stage</th><th>Surveyor</th><th>Target</th><th>Fee</th></tr></thead><tbody>{visible.map((job) => <tr key={job.id}><td data-label="Job"><strong>{job.client}</strong><span className="cell-sub">{job.address}</span><span className="reference">{job.reference}</span></td><td data-label="Service">{job.service}</td><td data-label="Stage"><StatusDot tone={tones[job.stage] ?? "slate"}>{jobStageLabels[job.stage]}</StatusDot></td><td data-label="Surveyor">{job.assignee}</td><td data-label="Target">{job.target}</td><td data-label="Fee">£{job.fee.toLocaleString("en-GB")}</td></tr>)}</tbody></table></div>
    <div className="table-footer"><span>Showing {visible.length} of {jobs.length} jobs</span><div className="pager"><button className="active">1</button></div></div>
  </section>;
}
