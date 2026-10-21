"use client";

import { useState } from "react";
import Link from "@/components/workspace-link";
import {
  Search,
  Plus,
  ClipboardList,
  Eye,
  X
} from "lucide-react";
import { jobs as demoJobs, type Job as DemoJob } from "@/lib/demo-data";
import "./manager-shared.css";
import "./manager-jobs.css";

interface JobRow {
  id: string;
  reference: string;
  service: string;
  client: string;
  address: string;
  timeTarget: string;
  stage: string;
  stageTone: "blue" | "amber" | "green" | "slate";
  nextAction: string;
}

// Built from the shared demo records, so the list matches the job pages,
// calendar and fieldwork views the demo opens from it.
const stageRows: Record<DemoJob["stage"], { stage: string; stageTone: JobRow["stageTone"]; nextAction: (target: string) => string }> = {
  enquiry: { stage: "Enquiry", stageTone: "slate", nextAction: () => "Send a quote" },
  quoted: { stage: "Follow-up", stageTone: "amber", nextAction: () => "Chase quote acceptance" },
  instructed: { stage: "Booked", stageTone: "green", nextAction: () => "Book the inspection" },
  scheduled: { stage: "Inspection", stageTone: "blue", nextAction: (target) => `Survey visit · ${target}` },
  inspection_complete: { stage: "Reporting", stageTone: "amber", nextAction: () => "Start the report" },
  report_drafting: { stage: "Reporting", stageTone: "amber", nextAction: (target) => `Surveyor report · due ${target}` },
  internal_review: { stage: "Review", stageTone: "amber", nextAction: (target) => `Senior review · ${target}` },
  issued: { stage: "Complete", stageTone: "slate", nextAction: () => "Report issued" },
  paid: { stage: "Complete", stageTone: "slate", nextAction: () => "Paid" },
  archived: { stage: "Complete", stageTone: "slate", nextAction: () => "Archived" },
};

const initialJobs: JobRow[] = demoJobs.map((job) => ({
  id: job.id,
  reference: job.reference,
  service: job.service,
  client: job.client,
  address: job.address,
  timeTarget: job.target,
  ...stageRows[job.stage],
  nextAction: stageRows[job.stage].nextAction(job.target),
}));

const needsAttention = (job: JobRow) => job.stageTone === "amber";
const inInspection = (job: JobRow) => job.stage === "Inspection" || job.stage === "Booked";
const inReporting = (job: JobRow) => job.stage === "Reporting" || job.stage === "Review" || job.stage === "Complete";

export function ManagerJobs({ slug }: { slug: string }) {
  const [jobs, setJobs] = useState<JobRow[]>(initialJobs);
  const [filter, setFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const filteredJobs = jobs.filter((job) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "attention" && needsAttention(job)) ||
      (filter === "inspection" && inInspection(job)) ||
      (filter === "report" && inReporting(job));

    const matchesSearch =
      job.reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.client.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.service.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  const activeCount = jobs.filter((job) => job.stage !== "Complete").length;
  const counts = {
    all: jobs.length,
    attention: jobs.filter(needsAttention).length,
    inspection: jobs.filter(inInspection).length,
    report: jobs.filter(inReporting).length,
  };

  const showNotice = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 3500);
  };

  const handleAddSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const client = fd.get("client") as string;
    const address = fd.get("address") as string;
    const service = fd.get("service") as string;

    const newJob: JobRow = {
      id: "job_" + Date.now(),
      reference: "SVY-" + Math.floor(1100 + Math.random() * 900),
      service,
      client,
      address,
      timeTarget: "Scheduled",
      stage: "Booked",
      stageTone: "green",
      nextAction: "Awaiting site survey allocation"
    };

    setJobs((prev) => [newJob, ...prev]);
    setShowAddModal(false);
    showNotice(`Job ${newJob.reference} created for ${client}.`);
  };

  return (
    <div className="manager-jobs-container">
      {toastMessage && (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46", padding: "12px 16px", borderRadius: 6, fontSize: 13 }}>
          <strong>Notice:</strong> {toastMessage}
        </div>
      )}

      {/* Header */}
      <div className="manager-jobs-header">
        <div className="manager-jobs-title-group">
          <span className="manager-jobs-eyebrow">JOB CONTROL · {activeCount} ACTIVE JOBS</span>
          <h1>Every job, at the right stage.</h1>
          <p>See what needs action, what’s in progress and what is ready to report.</p>
        </div>
        <button
          className="manager-btn-primary"
          onClick={() => setShowAddModal(true)}
        >
          <Plus size={16} /> New job
        </button>
      </div>

      {/* 4 Summary Cards */}
      <div className="manager-jobs-kpis">
        <div className="manager-jobs-kpi-card">
          <small>INSPECTIONS</small>
          <b>{counts.inspection}</b>
          <span>Booked and scheduled visits</span>
        </div>
        <div className="manager-jobs-kpi-card">
          <small>IN PROGRESS</small>
          <b>{activeCount}</b>
          <span>Open jobs</span>
        </div>
        <div className="manager-jobs-kpi-card">
          <small>NEEDS ATTENTION</small>
          <b style={{ color: "#b45309" }}>{counts.attention}</b>
          <span>Review or client follow-up</span>
        </div>
        <div className="manager-jobs-kpi-card">
          <small>READY TO REPORT</small>
          <b>{counts.report}</b>
          <span>Reporting and review</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="manager-jobs-toolbar">
        <div className="manager-search-box">
          <Search size={16} color="#94a3b8" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search reference, client or address"
            aria-label="Search jobs"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="manager-jobs-filters">
          {[
            { id: "all", label: "All jobs", count: counts.all },
            { id: "attention", label: "Needs attention", count: counts.attention },
            { id: "inspection", label: "Inspection", count: counts.inspection },
            { id: "report", label: "Reporting", count: counts.report }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`manager-jobs-filter-btn ${filter === tab.id ? "active" : ""}`}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label} <i>{tab.count}</i>
            </button>
          ))}
        </div>
      </div>

      {/* Table Panel */}
      <div className="manager-jobs-panel">
        <div className="manager-jobs-table-wrap">
          <table className="manager-jobs-table">
            <thead>
              <tr>
                <th>JOB / SERVICE</th>
                <th>CLIENT &amp; PROPERTY</th>
                <th>APPOINTMENT / TARGET</th>
                <th>STAGE</th>
                <th>NEXT ACTION</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <span className="job-ref-tag">{job.reference}</span>
                    <span className="job-service-text">{job.service}</span>
                  </td>
                  <td>
                    <div className="job-client-text">
                      <strong>{job.client}</strong>
                      <small>{job.address}</small>
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: 13, color: "#1e293b", fontWeight: 500 }}>
                      {job.timeTarget}
                    </span>
                  </td>
                  <td>
                    <span className={`job-stage-badge ${job.stageTone}`}>
                      {job.stage}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <small style={{ fontSize: 10, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>
                        NEXT ACTION
                      </small>
                      <strong style={{ fontSize: 12.5, color: "#0f172a" }}>
                        {job.nextAction}
                      </strong>
                    </div>
                  </td>
                  <td>
                    <div className="job-actions-group">
                      <Link
                        href={`/app/${slug}/jobs/${job.id}/survey`}
                        className="manager-btn-primary"
                        style={{ padding: "5px 10px", fontSize: 12, textDecoration: "none" }}
                      >
                        <ClipboardList size={13} /> Open survey
                      </Link>
                      <Link
                        href={`/app/${slug}/jobs/${job.id}`}
                        className="manager-btn-secondary"
                        style={{ padding: "5px 10px", fontSize: 12, textDecoration: "none" }}
                      >
                        <Eye size={13} /> View
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredJobs.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                    No jobs match your search or filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Job Modal */}
      {showAddModal && (
        <div className="manager-modal-overlay">
          <div className="manager-modal">
            <div className="manager-modal-header">
              <h3>Create new survey job</h3>
              <button
                className="manager-modal-close"
                onClick={() => setShowAddModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="manager-form-field">
                <label>Client name</label>
                <input name="client" required placeholder="e.g. Rachel Adams" />
              </div>
              <div className="manager-form-field">
                <label>Property address</label>
                <input name="address" required placeholder="e.g. 29 Manor Road, Richmond TW9 1YB" />
              </div>
              <div className="manager-form-field">
                <label>Survey service</label>
                <select name="service">
                  <option value="RICS Level 2 Home Survey">RICS Level 2 Home Survey</option>
                  <option value="Level 3 Building Survey">Level 3 Building Survey</option>
                  <option value="Residential Valuation">Residential Valuation</option>
                  <option value="Drone Roof Survey">Drone Roof Survey</option>
                </select>
              </div>
              <div className="manager-modal-actions">
                <button
                  type="button"
                  className="manager-btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="manager-btn-primary">
                  Create job record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
