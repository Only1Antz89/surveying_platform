"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, History } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { informationClassLabels, providerStatusLabels, type InformationClass, type ProviderStatus } from "@surveynt/property-data";
import type { HistoryEvent, PropertyHistory } from "@/lib/property-history";

const kindLabels: Record<HistoryEvent["kind"], string> = { sale: "Sale", energy_certificate: "Energy certificate", listing: "Listing", designation: "Designation", job_stage: "Job", survey: "Survey" };
const classTone: Record<InformationClass, "green" | "blue" | "amber"> = { surveyor_verified: "green", authoritative_external: "blue", indicative_external: "amber" };

/** Dates are shown as recorded: a year-month release stays a month, never an invented day. */
function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  if (/^\d{4}-\d{2}$/.test(value)) return new Date(`${value}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/London" });
}

const coverageText = (status: string) => status === "not_checked" ? "Not checked" : status === "not_configured" ? "Not checked" : status === "unsupported" ? "Not checked: not covered" : providerStatusLabels[status as ProviderStatus] ?? status;

/** One timeline of external records and the firm's own events, keeping event, publication and retrieval dates apart. */
export function PropertyHistoryPanel({ propertyId }: { propertyId: string }) {
  const [history, setHistory] = useState<PropertyHistory | null>(null);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/properties/${propertyId}/history`, { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json().catch(() => null) }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        if (!response.ok) return setError(payload?.error?.message ?? "History is unavailable.");
        setHistory(payload.data); setDemo(Boolean(payload.meta?.demo));
      })
      .catch(() => { if (!cancelled) setError("History is unavailable while offline."); });
    return () => { cancelled = true; };
  }, [propertyId]);

  if (error) return <section className="panel"><div className="empty-state"><strong>{error}</strong></div></section>;
  if (!history) return <section className="panel"><div className="empty-state"><strong>Loading history…</strong></div></section>;

  return <section className="panel" aria-labelledby="history-heading">
    <div className="panel-header"><div><h2 id="history-heading">Property history</h2><p>External records come from stored intelligence snapshots. Refresh intelligence on the Intelligence tab to update them.</p></div><History size={17} color="#3b82f6" aria-hidden="true" /></div>
    {demo ? <p className="address-demo-label intel-inline">Demo workspace: illustrative records, not live data.</p> : null}
    <ul className="history-coverage">
      {history.coverage.map((note) => <li key={note.label}><strong>{note.label}</strong><StatusDot tone={note.status === "matched" ? "blue" : "slate"}>{coverageText(note.status)}</StatusDot>{note.stale ? <span className="cell-sub">Retrieved for an earlier identity</span> : null}{note.message ? <span className="cell-sub">{note.message}</span> : null}</li>)}
    </ul>
    {history.events.length ? <ol className="history-timeline">
      {history.events.map((event) => <li key={event.id} className={`history-event ${event.stale ? "stale" : ""}`}>
        <div className="history-event-head">
          <span className="history-kind">{kindLabels[event.kind]}</span>
          <strong>{event.title}</strong>
          {event.origin === "firm" ? <StatusDot tone="green">Firm record</StatusDot> : <StatusDot tone={classTone[event.informationClass as InformationClass] ?? "amber"}>{informationClassLabels[event.informationClass as InformationClass] ?? "External record"}</StatusDot>}
        </div>
        {event.detail ? <span className="cell-sub">{event.detail}</span> : null}
        <dl className="history-dates">
          <div><dt>Event</dt><dd>{formatDate(event.eventDate)}</dd></div>
          {event.origin === "external" ? <><div><dt>Published</dt><dd>{event.publishedDate ? formatDate(event.publishedDate) : "Not stated by source"}</dd></div><div><dt>Retrieved</dt><dd>{formatDate(event.retrievedAt)}</dd></div></> : null}
        </dl>
        {event.stale ? <p className="identity-warning"><AlertTriangle size={14} aria-hidden="true" />Retrieved for an earlier location or identity of this property. Refresh before relying on it.</p> : null}
        {event.notes.map((note) => <span key={note} className="cell-sub">{note}</span>)}
        {event.evidence.length ? <div className="intel-evidence">{event.evidence.filter((item) => item.url.startsWith("https://")).map((item) => <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer">{item.label}<ExternalLink size={12} aria-hidden="true" /></a>)}</div> : null}
      </li>)}
    </ol> : <div className="empty-state compact"><strong>No history recorded yet</strong><span>This is not the same as no history: sources may not have been checked, or may not link records to this property.</span></div>}
  </section>;
}
