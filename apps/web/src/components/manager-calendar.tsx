"use client";

import { useState } from "react";
import Link from "@/components/workspace-link";
import {
  ChevronLeft,
  ChevronRight,
  Bot
} from "lucide-react";
import "./manager-shared.css";
import "./manager-calendar.css";

interface CalendarEvent {
  time: string;
  title: string;
  client: string;
  job: string;
  type: "survey" | "followup" | "report";
}

interface DayColumn {
  dayName: string;
  dateNum: string;
  isToday: boolean;
  events: CalendarEvent[];
}

const sampleWeekDays: DayColumn[] = [
  {
    dayName: "MON",
    dateNum: "05",
    isToday: false,
    events: [
      { time: "09:00", title: "Site inspection", client: "Jamie Morgan", job: "CS-24091", type: "survey" },
      { time: "14:30", title: "Follow-up call", client: "Alex Harper", job: "CS-24081", type: "followup" }
    ]
  },
  {
    dayName: "TUE",
    dateNum: "06",
    isToday: false,
    events: [
      { time: "10:00", title: "Level 2 survey", client: "Priya Patel", job: "CS-24084", type: "survey" },
      { time: "15:00", title: "Report review", client: "Olivia Reed", job: "CS-24078", type: "report" }
    ]
  },
  {
    dayName: "WED",
    dateNum: "07",
    isToday: false,
    events: [
      { time: "09:30", title: "Building survey", client: "Morgan Lewis", job: "CS-24076", type: "survey" },
      { time: "13:30", title: "Report issued", client: "Olivia Reed", job: "CS-24078", type: "report" }
    ]
  },
  {
    dayName: "THU",
    dateNum: "08",
    isToday: true,
    events: [
      { time: "09:00", title: "Level 2 survey", client: "Alex Harper", job: "CS-24081", type: "survey" },
      { time: "11:45", title: "Residential valuation", client: "Priya Patel", job: "CS-24084", type: "survey" },
      { time: "14:00", title: "Building survey", client: "Morgan Lewis", job: "CS-24076", type: "survey" },
      { time: "16:15", title: "Access call", client: "Samira Khan", job: "CS-24089", type: "followup" }
    ]
  },
  {
    dayName: "FRI",
    dateNum: "09",
    isToday: false,
    events: [
      { time: "09:30", title: "Level 2 survey", client: "Jamie Morgan", job: "CS-24091", type: "survey" },
      { time: "12:00", title: "Drone inspection", client: "Taylor Bennett", job: "CS-24094", type: "survey" },
      { time: "15:00", title: "Residential valuation", client: "Nadia Wilson", job: "CS-24096", type: "survey" }
    ]
  },
  {
    dayName: "SAT",
    dateNum: "10",
    isToday: false,
    events: []
  },
  {
    dayName: "SUN",
    dateNum: "11",
    isToday: false,
    events: []
  }
];

export function ManagerCalendar({ slug }: { slug: string }) {
  const [viewMode, setViewMode] = useState<"week" | "day">("week");
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [toastMessage, setToastMessage] = useState("");

  const showNotice = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 3500);
  };

  return (
    <div className="manager-cal-container">
      {toastMessage && (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46", padding: "12px 16px", borderRadius: 6, fontSize: 13 }}>
          <strong>Notice:</strong> {toastMessage}
        </div>
      )}

      {/* Header */}
      <div className="manager-cal-header">
        <div className="manager-cal-title-group">
          <span className="manager-cal-eyebrow">SCHEDULE &amp; CAPACITY · LONDON TEAM</span>
          <h1>Make room for the work.</h1>
          <p>Appointments, travel gaps and follow-ups across the surveying week.</p>
        </div>
      </div>

      {/* Main Calendar Panel */}
      <div className="manager-cal-panel">
        {/* Toolbar */}
        <div className="manager-cal-toolbar">
          <div className="manager-cal-range">
            <small>WEEK 41 / 2026</small>
            <h2>5–11 October 2026</h2>
          </div>
          <div className="manager-cal-controls">
            <button
              type="button"
              className="manager-cal-nav-btn"
              aria-label="Previous week"
              onClick={() => showNotice("Showing sample calendar for October 2026.")}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="manager-cal-nav-btn"
              onClick={() => showNotice("Showing current week.")}
            >
              Today
            </button>
            <button
              type="button"
              className="manager-cal-nav-btn"
              aria-label="Next week"
              onClick={() => showNotice("Showing sample calendar for October 2026.")}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
            <div className="manager-cal-view-toggle">
              <button
                type="button"
                className={`manager-cal-toggle-btn ${viewMode === "week" ? "active" : ""}`}
                onClick={() => setViewMode("week")}
              >
                Week
              </button>
              <button
                type="button"
                className={`manager-cal-toggle-btn ${viewMode === "day" ? "active" : ""}`}
                onClick={() => setViewMode("day")}
              >
                Day
              </button>
            </div>
          </div>
        </div>

        {/* Week Mode Grid */}
        {viewMode === "week" ? (
          <div className="manager-cal-grid" role="region" aria-label="Week of appointments" tabIndex={0}>
            {sampleWeekDays.map((col) => (
              <div
                key={col.dayName}
                className={`manager-cal-day-col ${col.isToday ? "today" : ""}`}
              >
                <div className="manager-cal-day-head">
                  <div className="manager-cal-day-label">
                    <small>{col.dayName}</small>
                    <b>{col.dateNum}</b>
                  </div>
                  {col.isToday && (
                    <span className="manager-cal-today-badge">Today</span>
                  )}
                </div>
                <div className="manager-cal-events-list">
                  {col.events.map((evt) => (
                    <div
                      key={evt.job}
                      className={`manager-cal-event-card ${evt.type}`}
                      onClick={() => {
                        setSelectedEvent(evt);
                        showNotice(`Selected ${evt.job} · ${evt.client} (${evt.title})`);
                      }}
                    >
                      <span className="manager-cal-event-time">{evt.time}</span>
                      <strong className="manager-cal-event-title">{evt.title}</strong>
                      <span className="manager-cal-event-client">{evt.client}</span>
                    </div>
                  ))}
                  {col.events.length === 0 && (
                    <div style={{ textAlign: "center", padding: "20px 0", color: "#64748b", fontSize: 12 }}>
                      No visits
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Day / Agenda Mode */
          <div className="manager-cal-agenda">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
                Thursday 8 October · 4 field visits scheduled
              </span>
              <span style={{ fontSize: 12, color: "#64748b" }}>London operating region</span>
            </div>
            {sampleWeekDays[3].events.map((evt) => (
              <div key={evt.job} className="manager-agenda-row">
                <div className="manager-agenda-info">
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <span style={{ background: "#2563eb", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                      {evt.time}
                    </span>
                    <strong>{evt.title}</strong>
                  </div>
                  <span>Client: {evt.client} · Job reference: <strong>{evt.job}</strong></span>
                </div>
                <Link
                  href={`/app/${slug}/jobs`}
                  className="manager-btn-secondary"
                  style={{ fontSize: 12 }}
                >
                  Open job &rarr;
                </Link>
              </div>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="manager-cal-legend">
          <div className="manager-legend-items">
            <div className="manager-legend-item">
              <span className="manager-legend-dot survey" />
              <span>Inspection / valuation</span>
            </div>
            <div className="manager-legend-item">
              <span className="manager-legend-dot followup" />
              <span>Follow-up</span>
            </div>
            <div className="manager-legend-item">
              <span className="manager-legend-dot report" />
              <span>Report / desk work</span>
            </div>
          </div>
          <span>Select an appointment to preview or focus its job record.</span>
        </div>

        {selectedEvent && (
          <div style={{ padding: "10px 14px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 13, color: "#1e40af", display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 14px" }}>
            <span>
              <strong>Selected appointment:</strong> {selectedEvent.time} · {selectedEvent.title} ({selectedEvent.client} — {selectedEvent.job})
            </span>
            <Link href={`/app/${slug}/jobs`} style={{ fontWeight: 700, color: "#2563eb", textDecoration: "none" }}>
              View job &rarr;
            </Link>
          </div>
        )}
      </div>

      {/* Lower Cards: Capacity & Assistant */}
      <div className="manager-cal-lower">
        <div className="manager-capacity-card">
          <small>WEEK AT A GLANCE</small>
          <b>11.5 / 20 field hours scheduled</b>
          <div className="manager-capacity-track">
            <div className="manager-capacity-fill" style={{ width: "57.5%" }} />
          </div>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            Room remains for urgent instructions, access rescheduling and travel variation.
          </span>
        </div>

        <div className="manager-intelligence-card">
          <div className="manager-intelligence-content">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Bot size={18} color="#2563eb" />
              <strong style={{ margin: 0 }}>Schedule intelligence</strong>
            </div>
            <p>SurvAI can summarise clashes, gaps and preparation tasks by case.</p>
          </div>
          <button
            className="manager-btn-primary"
            onClick={() => showNotice("SurvAI: No scheduling conflicts detected for today's visits.")}
          >
            Ask SurvAI &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
