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

const initialJobs: JobRow[] = [
  {
    id: "job_01",
    reference: "CS-24081",
    service: "RICS Level 2 Home Survey",
    client: "Alex Harper",
    address: "14 Elmwood Road, Chiswick · W4 3AA",
    timeTarget: "Today, 09:00–11:00",
    stage: "Inspection",
    stageTone: "blue",
    nextAction: "Survey visit · 09:00"
  },
  {
    id: "job_02",
    reference: "CS-24084",
    service: "Residential Valuation",
    client: "Priya Patel",
    address: "8 The Grove, Ealing · W5 2AB",
    timeTarget: "Today, 11:45–12:30",
    stage: "Preparation",
    stageTone: "amber",
    nextAction: "Confirm access · before 11:45"
  },
  {
    id: "job_03",
    reference: "CS-24076",
    service: "Level 3 Building Survey",
    client: "Morgan Lewis",
    address: "22 Birch Avenue, Acton · W3 7QJ",
    timeTarget: "Today, 14:00–16:00",
    stage: "Reporting",
    stageTone: "amber",
    nextAction: "Surveyor review · due today"
  },
  {
    id: "job_04",
    reference: "CS-24089",
    service: "Roof & Chimney Access Follow-up",
    client: "Samira Khan",
    address: "London · W4",
    timeTarget: "Today, 16:15–16:45",
    stage: "Follow-up",
    stageTone: "amber",
    nextAction: "Call client · 16:15"
  },
  {
    id: "job_05",
    reference: "CS-24091",
    service: "Level 2 Home Survey",
    client: "Jamie Morgan",
    address: "6 Linden Gardens, Hammersmith · W6 0PH",
    timeTarget: "Tomorrow, 09:30",
    stage: "Booked",
    stageTone: "green",
    nextAction: "Prepare case · tomorrow 09:30"
  },
  {
    id: "job_06",
    reference: "CS-24094",
    service: "Drone Inspection",
    client: "Taylor Bennett",
    address: "31 St Mary’s Road, Ealing · W5 5RA",
    timeTarget: "Tomorrow, 12:00",
    stage: "Booked",
    stageTone: "green",
    nextAction: "Drone visit · tomorrow 12:00"
  },
  {
    id: "job_07",
    reference: "CS-24096",
    service: "Residential Valuation",
    client: "Nadia Wilson",
    address: "4 Oakfield Close, Richmond · TW9 2AB",
    timeTarget: "Tomorrow, 15:00",
    stage: "Booked",
    stageTone: "green",
    nextAction: "Valuation · tomorrow 15:00"
  },
  {
    id: "job_08",
    reference: "CS-24078",
    service: "Level 2 Home Survey",
    client: "Olivia Reed",
    address: "17 Willow Lane, Brentford · TW8 0AA",
    timeTarget: "7 Oct 2026",
    stage: "Complete",
    stageTone: "slate",
    nextAction: "Report issued · 7 October"
  }
];

export function ManagerJobs({ slug }: { slug: string }) {
  const [jobs, setJobs] = useState<JobRow[]>(initialJobs);
  const [filter, setFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const filteredJobs = jobs.filter((job) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "attention" && (job.stageTone === "amber" || job.stage === "Follow-up")) ||
      (filter === "inspection" && (job.stage === "Inspection" || job.stage === "Booked")) ||
      (filter === "report" && (job.stage === "Reporting" || job.stage === "Complete"));

    const matchesSearch =
      job.reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.client.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.service.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesFilter && matchesSearch;
  });

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
      reference: "CS-" + Math.floor(24100 + Math.random() * 900),
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
          <span className="manager-jobs-eyebrow">JOB CONTROL · 8 ACTIVE JOBS</span>
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
          <b>4</b>
          <span>Today &amp; tomorrow</span>
        </div>
        <div className="manager-jobs-kpi-card">
          <small>IN PROGRESS</small>
          <b>3</b>
          <span>Evidence and inspection</span>
        </div>
        <div className="manager-jobs-kpi-card">
          <small>NEEDS ATTENTION</small>
          <b style={{ color: "#d97706" }}>3</b>
          <span>Review or client follow-up</span>
        </div>
        <div className="manager-jobs-kpi-card">
          <small>READY TO REPORT</small>
          <b>1</b>
          <span>Surveyor check required</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="manager-jobs-toolbar">
        <div className="manager-search-box">
          <Search size={16} color="#94a3b8" />
          <input
            type="text"
            placeholder="Search reference, client or address"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="manager-jobs-filters">
          {[
            { id: "all", label: "All jobs", count: 8 },
            { id: "attention", label: "Needs attention", count: 3 },
            { id: "inspection", label: "Inspection", count: 3 },
            { id: "report", label: "Reporting", count: 2 }
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
                        href={`/app/${slug}/jobs/${job.id}`}
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
