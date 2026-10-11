"use client";

import { useState } from "react";
import Link from "@/components/workspace-link";
import {
  TrendingUp,
  Clock,
  Bot,
  Zap,
  ArrowRight,
  Download,
  Calendar,
  CheckCircle2,
  ChevronDown,
  X,
  FileSpreadsheet,
  FileText
} from "lucide-react";
import "./manager-reports.css";

interface DailyDelivery {
  day: string;
  fullDay: string;
  jobs: number;
  reports: number;
}

interface ServiceMix {
  label: string;
  count: number;
  pct: number;
}

const weeklyData: DailyDelivery[] = [
  { day: "Mon", fullDay: "Monday 5 Oct", jobs: 18, reports: 12 },
  { day: "Tue", fullDay: "Tuesday 6 Oct", jobs: 24, reports: 17 },
  { day: "Wed", fullDay: "Wednesday 7 Oct", jobs: 16, reports: 13 },
  { day: "Thu", fullDay: "Thursday 8 Oct", jobs: 27, reports: 19 },
  { day: "Fri", fullDay: "Friday 9 Oct", jobs: 22, reports: 16 },
  { day: "Sat", fullDay: "Saturday 10 Oct", jobs: 8, reports: 5 },
  { day: "Sun", fullDay: "Sunday 11 Oct", jobs: 4, reports: 2 }
];

const serviceMixData: ServiceMix[] = [
  { label: "Level 2 Home Survey", count: 18, pct: 72 },
  { label: "Level 3 Building Survey", count: 9, pct: 56 },
  { label: "Residential Valuation", count: 7, pct: 44 },
  { label: "Drone Roof Survey", count: 4, pct: 31 },
  { label: "Land & Planning Review", count: 3, pct: 22 }
];

const officeTurnaround = [
  { office: "Watford Regional Base", turnaround: "3.4 days", activeSurveyors: 3, jobsCompleted: 9 },
  { office: "North London Hub", turnaround: "4.1 days", activeSurveyors: 3, jobsCompleted: 8 },
  { office: "South London / Croydon Base", turnaround: "4.8 days", activeSurveyors: 2, jobsCompleted: 6 }
];

interface ManagerReportsProps {
  slug?: string;
  organisationSlug?: string;
}

export function ManagerReports({ slug, organisationSlug }: ManagerReportsProps) {
  const currentSlug = slug || organisationSlug || "clifton-surveyors";
  const [selectedPeriod, setSelectedPeriod] = useState("This week · 5–11 Oct");
  const [isPeriodMenuOpen, setIsPeriodMenuOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [hoveredDay, setHoveredDay] = useState<DailyDelivery | null>(null);

  const periods = [
    "This week · 5–11 Oct",
    "Last week · 28 Sep–4 Oct",
    "Last 30 days",
    "This quarter (Q4 2026)"
  ];

  const handleExport = (format: "csv" | "pdf") => {
    const filename = `clifton-surveyors-report-${format === "csv" ? "summary.csv" : "digest.pdf"}`;
    alert(`Export initiated: ${filename} is downloading.`);
    setIsExportOpen(false);
  };

  return (
    <div className="manager-rep-container">
      {/* Header */}
      <header className="manager-rep-header">
        <div className="manager-rep-title-group">
          <span className="manager-rep-eyebrow">Business Reporting</span>
          <h1>See where time and capacity go.</h1>
          <p>
            Operational insights combine job status, staff capacity and Surveyant assistance activity.
          </p>
        </div>

        <div className="manager-rep-header-actions">
          <div style={{ position: "relative" }}>
            <button
              className="manager-rep-filter-control"
              onClick={() => setIsPeriodMenuOpen(!isPeriodMenuOpen)}
              aria-label="Filter report period"
            >
              <Calendar size={14} color="#64748b" />
              <span>{selectedPeriod}</span>
              <ChevronDown size={14} color="#64748b" />
            </button>

            {isPeriodMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: 6,
                  background: "#ffffff",
                  border: "1px solid #dce5f2",
                  borderRadius: 8,
                  boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
                  zIndex: 50,
                  minWidth: 200,
                  overflow: "hidden"
                }}
              >
                {periods.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setSelectedPeriod(p);
                      setIsPeriodMenuOpen(false);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "10px 14px",
                      textAlign: "left",
                      fontSize: 13,
                      color: p === selectedPeriod ? "#2563eb" : "#334155",
                      fontWeight: p === selectedPeriod ? 700 : 500,
                      background: p === selectedPeriod ? "#eff6ff" : "transparent",
                      border: "none",
                      cursor: "pointer"
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            className="manager-rep-export-btn"
            onClick={() => setIsExportOpen(true)}
          >
            <Download size={14} />
            <span>Export digest</span>
          </button>
        </div>
      </header>

      {/* 4 KPIs */}
      <div className="manager-rep-kpis">
        <article className="manager-rep-kpi-card">
          <small>Jobs Completed</small>
          <div className="manager-rep-kpi-val">23</div>
          <span className="manager-rep-kpi-sub positive">↑ 4 vs last week</span>
        </article>

        <article className="manager-rep-kpi-card">
          <small>Average Turnaround</small>
          <div className="manager-rep-kpi-val">
            4.2 <i>days</i>
          </div>
          <span className="manager-rep-kpi-sub">Across issued reports</span>
        </article>

        <article className="manager-rep-kpi-card">
          <small>Surveyant Assisted</small>
          <div className="manager-rep-kpi-val">
            42 <i>checks</i>
          </div>
          <span className="manager-rep-kpi-sub">7 awaiting surveyor sign-off</span>
        </article>

        <article className="manager-rep-kpi-card">
          <small>Admin Time Returned</small>
          <div className="manager-rep-kpi-val">
            11.4 <i>hrs</i>
          </div>
          <span className="manager-rep-kpi-sub">Estimated from assisted work</span>
        </article>
      </div>

      {/* 2-Column Reports Layout */}
      <div className="manager-rep-layout">
        {/* Weekly Delivery Dual-Bar Chart */}
        <section className="manager-rep-panel">
          <div className="manager-rep-panel-head">
            <div>
              <small>Weekly Delivery</small>
              <h2>Jobs completed &amp; reports issued</h2>
            </div>
            <div className="manager-rep-chart-legend">
              <span className="manager-rep-legend-item">
                <i className="manager-rep-legend-jobs"></i> Jobs
              </span>
              <span className="manager-rep-legend-item">
                <i className="manager-rep-legend-reports"></i> Reports
              </span>
            </div>
          </div>

          <div className="manager-rep-chart">
            <div className="manager-rep-chart-y-labels">
              <span>30</span>
              <span>20</span>
              <span>10</span>
              <span>0</span>
            </div>

            <div className="manager-rep-chart-columns">
              {weeklyData.map((col) => {
                const maxVal = 30;
                const jobsHeight = Math.min(100, (col.jobs / maxVal) * 100);
                const reportsHeight = Math.min(100, (col.reports / maxVal) * 100);

                return (
                  <div
                    key={col.day}
                    className="manager-rep-chart-day"
                    onMouseEnter={() => setHoveredDay(col)}
                    onMouseLeave={() => setHoveredDay(null)}
                    title={`${col.fullDay}: ${col.jobs} jobs, ${col.reports} reports`}
                  >
                    <div className="manager-rep-chart-bars">
                      <span
                        className="manager-rep-bar-jobs"
                        style={{ height: `${jobsHeight}%` }}
                      ></span>
                      <span
                        className="manager-rep-bar-reports"
                        style={{ height: `${reportsHeight}%` }}
                      ></span>
                    </div>
                    <small>{col.day}</small>
                  </div>
                );
              })}
            </div>
          </div>

          {hoveredDay && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                background: "#f1f5f9",
                borderRadius: 6,
                fontSize: 12,
                color: "#334155",
                display: "flex",
                justifyContent: "space-between"
              }}
            >
              <strong>{hoveredDay.fullDay}</strong>
              <span>
                <b>{hoveredDay.jobs}</b> inspections conducted · <b>{hoveredDay.reports}</b> reports issued
              </span>
            </div>
          )}
        </section>

        {/* Surveyant Insight Card */}
        <section className="manager-rep-panel manager-rep-surveyant-card">
          <div>
            <div className="manager-rep-bot-badge">
              <Bot size={22} />
            </div>
            <small className="label">Surveyant Insight</small>
            <h3>Preparation is smoothing the morning handover.</h3>
            <p>
              Most assisted checks are completed before the first site visit. 7 items still need a surveyor decision.
            </p>

            <div className="manager-rep-surveyant-bullets">
              <div className="manager-rep-bullet-item">
                <Zap size={14} />
                <span>
                  <strong>Fastest turnaround:</strong> Watford regional team is averaging 3.4 days from inspection to sign-off.
                </span>
              </div>
              <div className="manager-rep-bullet-item">
                <TrendingUp size={14} />
                <span>
                  <strong>High value work:</strong> Level 3 building surveys account for 46% of surveyor site hours.
                </span>
              </div>
              <div className="manager-rep-bullet-item">
                <CheckCircle2 size={14} />
                <span>
                  <strong>Data completeness:</strong> 100% of photographic evidence tagged and classified automatically.
                </span>
              </div>
            </div>
          </div>

          <Link
            href={`/app/${currentSlug}/jobs`}
            className="manager-rep-surveyant-action"
          >
            Review pending cases <ArrowRight size={14} />
          </Link>
        </section>
      </div>

      {/* Service Delivery Mix & Office Turnaround */}
      <div className="manager-rep-bottom-grid">
        {/* Service Performance */}
        <section className="manager-rep-panel manager-rep-mix-panel">
          <div className="manager-rep-panel-head">
            <div>
              <small>Delivery Mix</small>
              <h2>Volume by service</h2>
            </div>
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Active this week</span>
          </div>

          <div className="manager-rep-performance-rows">
            {serviceMixData.map((item) => (
              <div key={item.label} className="manager-rep-perf-row">
                <b>{item.label}</b>
                <div className="manager-rep-perf-bar-track">
                  <div
                    className="manager-rep-perf-bar-fill"
                    style={{ width: `${item.pct}%` }}
                  ></div>
                </div>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </section>

        {/* Office Turnaround Efficiency */}
        <section className="manager-rep-panel">
          <div className="manager-rep-panel-head">
            <div>
              <small>Office Hubs</small>
              <h2>Turnaround by operating base</h2>
            </div>
            <Clock size={16} color="#64748b" />
          </div>

          <div className="manager-rep-efficiency-list">
            {officeTurnaround.map((office) => (
              <div key={office.office} className="manager-rep-eff-item">
                <span>
                  <b>{office.office}</b>
                  <small>
                    {office.activeSurveyors} active surveyors · {office.jobsCompleted} jobs completed
                  </small>
                </span>
                <strong>{office.turnaround}</strong>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 18,
              padding: 12,
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 8,
              fontSize: 12,
              color: "#1e40af",
              display: "flex",
              alignItems: "center",
              gap: 8
            }}
          >
            <CheckCircle2 size={16} color="#2563eb" />
            <span>
              RICS compliance benchmarks met across all 3 practice operational locations this week.
            </span>
          </div>
        </section>
      </div>

      {/* Export Modal */}
      {isExportOpen && (
        <div className="manager-rep-modal-overlay" onClick={() => setIsExportOpen(false)}>
          <div className="manager-rep-modal" onClick={(e) => e.stopPropagation()}>
            <div className="manager-rep-modal-head">
              <h3>Export Operational Report</h3>
              <button
                className="manager-rep-modal-close"
                onClick={() => setIsExportOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="manager-rep-modal-body">
              <p>
                Select your preferred format for the {selectedPeriod} operational summary. Reports include surveyor allocations, job completion rates, and Surveyant activity logs.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <button
                  onClick={() => handleExport("csv")}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    padding: 18,
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    cursor: "pointer"
                  }}
                >
                  <FileSpreadsheet size={28} color="#16a34a" />
                  <strong style={{ fontSize: 13, color: "#0f172a" }}>CSV Spreadsheet</strong>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Raw data &amp; metrics</span>
                </button>

                <button
                  onClick={() => handleExport("pdf")}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    padding: 18,
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    cursor: "pointer"
                  }}
                >
                  <FileText size={28} color="#2563eb" />
                  <strong style={{ fontSize: 13, color: "#0f172a" }}>PDF Digest</strong>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Print-ready layout</span>
                </button>
              </div>
            </div>

            <div className="manager-rep-modal-actions">
              <button
                onClick={() => setIsExportOpen(false)}
                style={{
                  padding: "8px 14px",
                  background: "#ffffff",
                  border: "1px solid #dce5f2",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "#475569"
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ManagerReports;
