"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, CheckCircle2, ExternalLink, FileCheck2, History, Info, LandPlot, Map as MapIcon, RefreshCw, SearchCheck, ShieldCheck, X } from "lucide-react";

const PropertyMap = dynamic(() => import("./property-map").then((module) => module.PropertyMap), { ssr: false, loading: () => <div className="map-empty"><span>Loading map…</span></div> });

type PropertyRecord = {
  id: string; line1: string; line2: string | null; city: string; postcode: string; propertyType: string | null; version: number;
  country: "ENG" | "WLS" | "SCT" | "NIR" | null; uprn: string | null; latitude: number | null; longitude: number | null;
  locationConfidence: "unresolved" | "approximate" | "confirmed" | "exact"; addressSource: string | null; resolvedAt: string | null;
};
type JobRecord = { id: string; reference: string; serviceName: string; stage: string; targetDate: string | null };
type EventRecord = { id: string; action: string; occurredAt: string; metadata: Record<string, unknown> };
type Snapshot = { id: string; sourceKey: string; category: string; resultStatus: string; informationClass: string; coverageStatus: string; confidence: number; retrievedAt: string; sourceUpdatedAt: string | null; attribution: string; data: { records?: Array<{ title?: string; summary?: string; data?: Record<string, unknown>; evidence?: Array<{ label: string; url: string }> }> }; evidence: Array<{ label: string; url: string }> };
type Source = { key: string; name: string; organisation: string; limitations: string | null; attribution: string; enabled: boolean; latestSuccessfulSyncAt: string | null; documentationUrl: string };
type Intelligence = { runs: Array<{ id: string; status: string; createdAt: string; providerStatuses: Record<string, string> }>; snapshots: Snapshot[]; sources: Source[] };
type AddressCandidate = { providerKey: "postcodes_io" | "nominatim"; sourceRecordId: string; displayLabel: string; line1: string; line2: string | null; city: string; postcode: string; country: "ENG"; latitude: number; longitude: number; precision: "address" | "street" | "postcode" | "place"; attribution: string };
type Resolution = { candidate: AddressCandidate; location: { latitude: number; longitude: number; precision: string }; uprnCandidates: Array<{ uprn: string; latitude: number; longitude: number; distanceMetres: number }>; requiresConfirmation: boolean; warning: string };

const tabs = ["Overview", "Intelligence", "Planning", "Land & Map", "History", "Sources"] as const;
type Tab = (typeof tabs)[number];

const statusLabel: Record<string, string> = { matched: "Record found", no_match: "No record found", unsupported: "Outside coverage", not_configured: "Not checked", unavailable: "Unavailable", error: "Check failed" };
const classLabel: Record<string, string> = { surveyor_verified: "Surveyor verified", authoritative_external: "Authoritative external record", indicative_external_context: "Indicative external context" };

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }) : "Not available";
}

export function PropertyIntelligenceWorkspace({ organisationSlug, property: initialProperty, clientName, jobs, events, canEdit, initialTab = "Overview" }: { organisationSlug: string; property: PropertyRecord; clientName: string; jobs: JobRecord[]; events: EventRecord[]; canEdit: boolean; initialTab?: Tab }) {
  const [property, setProperty] = useState(initialProperty);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [intelligence, setIntelligence] = useState<Intelligence>({ runs: [], snapshots: [], sources: [] });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [query, setQuery] = useState([property.line1, property.city, property.postcode].join(", "));
  const [candidates, setCandidates] = useState<AddressCandidate[]>([]);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [searching, setSearching] = useState(false);

  async function loadIntelligence() {
    setLoading(true);
    const response = await fetch(`/api/v1/properties/${property.id}/intelligence`);
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) return setMessage(payload?.error?.message ?? "Property intelligence could not be loaded.");
    setIntelligence(payload.data as Intelligence);
  }

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/properties/${property.id}/intelligence`).then(async (response) => ({ response, payload: await response.json() })).then(({ response, payload }) => {
      if (!active) return;
      setLoading(false);
      if (!response.ok) setMessage(payload?.error?.message ?? "Property intelligence could not be loaded.");
      else setIntelligence(payload.data as Intelligence);
    });
    return () => { active = false; };
  }, [property.id]);
  const latestRun = intelligence.runs[0];

  useEffect(() => {
    if (latestRun?.status !== "queued" && latestRun?.status !== "running") return;
    let active = true;
    const timer = window.setInterval(() => {
      void fetch(`/api/v1/properties/${property.id}/intelligence`).then(async (response) => ({ response, payload: await response.json() })).then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok) setMessage(payload?.error?.message ?? "Property intelligence could not be refreshed.");
        else setIntelligence(payload.data as Intelligence);
      });
    }, 3_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [latestRun?.status, property.id]);

  useEffect(() => {
    if (!identityOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIdentityOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [identityOpen]);

  const planning = intelligence.snapshots.filter((snapshot) => snapshot.category === "planning" || snapshot.category === "heritage");
  const environment = intelligence.snapshots.filter((snapshot) => snapshot.category === "environment" || snapshot.category === "land");
  const sourceMap = useMemo(() => new Map(intelligence.sources.map((source) => [source.key, source])), [intelligence.sources]);

  async function search(event: FormEvent) {
    event.preventDefault(); setSearching(true); setMessage(null); setResolution(null);
    const response = await fetch(`/api/v1/address/search?q=${encodeURIComponent(query)}`);
    const payload = await response.json(); setSearching(false);
    if (!response.ok) return setMessage(payload?.error?.message ?? "Address search is unavailable. You can enter coordinates manually.");
    setCandidates(payload.data as AddressCandidate[]);
  }

  async function resolve(candidate: AddressCandidate) {
    setSearching(true); setMessage(null);
    const response = await fetch("/api/v1/address/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(candidate) });
    const payload = await response.json(); setSearching(false);
    if (!response.ok) return setMessage(payload?.error?.message ?? "The selected address could not be resolved.");
    setResolution(payload.data as Resolution);
  }

  async function confirmIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    const form = new FormData(event.currentTarget);
    const latitude = Number(form.get("latitude"));
    const longitude = Number(form.get("longitude"));
    const uprn = String(form.get("uprn") || "") || null;
    const selected = resolution?.uprnCandidates.find((candidate) => candidate.uprn === uprn);
    const providerKey = resolution?.candidate.providerKey ?? "manual";
    const response = await fetch(`/api/v1/properties/${property.id}/identity/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: property.version, country: "ENG", uprn, latitude, longitude, addressSource: providerKey, resolutionMethod: uprn ? "uprn_candidate_confirmed" : resolution?.candidate.precision === "postcode" ? "postcode_centroid" : resolution ? "geocoder_selection" : "manual_coordinates", evidence: { providerKey, sourceRecordId: resolution?.candidate.sourceRecordId ?? "manual", label: resolution?.candidate.displayLabel ?? "Coordinates entered manually", distanceMetres: selected?.distanceMetres } }) });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload?.error?.message ?? "Property identity could not be saved.");
    setProperty((current) => ({ ...current, country: "ENG", uprn, latitude, longitude, addressSource: providerKey, locationConfidence: uprn ? "confirmed" : "approximate", version: Number(payload.data.version ?? current.version + 1), resolvedAt: payload.data.resolvedAt ? String(payload.data.resolvedAt) : new Date().toISOString() }));
    setIdentityOpen(false); setResolution(null); setCandidates([]); setMessage("Property identity confirmed. External records will remain separate from surveyor observations.");
  }

  async function refresh() {
    setMessage(null);
    const response = await fetch(`/api/v1/properties/${property.id}/intelligence/refresh`, { method: "POST", headers: { "idempotency-key": `property:${property.id}:${Date.now()}` } });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload?.error?.message ?? "The refresh could not be queued.");
    setMessage(payload.data.duplicate ? "This refresh is already queued." : "Refresh queued. Source statuses will update after processing.");
    await loadIntelligence();
  }

  return <main className="property-workspace">
    <div className="property-back"><Link href={`/app/${organisationSlug}/properties`}><ArrowLeft size={14} />Properties</Link></div>
    <header className="property-hero">
      <div className="property-title"><div className="property-icon"><Building2 size={22} /></div><div><h1>{property.line1}</h1><p>{[property.line2, property.city, property.postcode].filter(Boolean).join(", ")}</p><div className="property-identity-line"><span>{property.uprn ? `UPRN ${property.uprn}` : "UPRN not confirmed"}</span><span>{property.locationConfidence === "unresolved" ? "Location unresolved" : `${property.locationConfidence} location`}</span></div></div></div>
      <div className="property-actions">{canEdit ? <button className="button button-secondary" onClick={() => setIdentityOpen(true)}><SearchCheck size={15} />{property.latitude === null ? "Resolve identity" : "Review identity"}</button> : null}<button className="button button-primary" onClick={refresh} disabled={!canEdit || property.latitude === null || latestRun?.status === "queued" || latestRun?.status === "running"}><RefreshCw size={15} />Refresh intelligence</button></div>
    </header>
    {message ? <div className="property-notice" role="status"><Info size={16} />{message}<button aria-label="Dismiss message" onClick={() => setMessage(null)}><X size={14} /></button></div> : null}
    <nav className="property-tabs" aria-label="Property sections">{tabs.map((tab) => <button key={tab} className={activeTab === tab ? "active" : ""} aria-current={activeTab === tab ? "page" : undefined} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav>

    {activeTab === "Overview" ? <div className="property-two-column"><section className="panel"><div className="panel-header"><div><h2>Property record</h2><p>Surveynt’s working record for this instruction address</p></div></div><dl className="detail-grid"><div className="detail"><dt>Property type</dt><dd>{property.propertyType ?? "Not recorded"}</dd></div><div className="detail"><dt>Responsible client</dt><dd>{clientName}</dd></div><div className="detail"><dt>Country</dt><dd>{property.country === "ENG" ? "England" : "Not resolved"}</dd></div><div className="detail"><dt>Location</dt><dd>{property.latitude === null ? "Not resolved" : `${property.latitude.toFixed(6)}, ${property.longitude?.toFixed(6)}`}</dd></div><div className="detail"><dt>Identity source</dt><dd>{property.addressSource ?? "Manual address"}</dd></div><div className="detail"><dt>Confirmed</dt><dd>{formatDate(property.resolvedAt)}</dd></div></dl></section><section className="panel"><div className="panel-header"><div><h2>Linked jobs</h2><p>{jobs.length} recorded {jobs.length === 1 ? "instruction" : "instructions"}</p></div></div>{jobs.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Reference</th><th>Service</th><th>Stage</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.reference}</strong></td><td>{job.serviceName}</td><td>{job.stage.replaceAll("_", " ")}</td></tr>)}</tbody></table></div> : <div className="empty-state compact"><strong>No linked jobs</strong></div>}</section></div> : null}

    {activeTab === "Intelligence" ? <SnapshotView title="Property intelligence" description="Latest provider results, kept separate from surveyor observations" snapshots={intelligence.snapshots} loading={loading} sourceMap={sourceMap} /> : null}
    {activeTab === "Planning" ? <SnapshotView title="Planning and heritage" description="Coverage varies by dataset and local planning authority" snapshots={planning} loading={loading} sourceMap={sourceMap} /> : null}
    {activeTab === "Land & Map" ? <div className="map-layout"><section className="panel map-panel">{property.latitude !== null && property.longitude !== null ? <PropertyMap propertyId={property.id} latitude={property.latitude} longitude={property.longitude} /> : <div className="map-empty"><MapIcon size={24} /><strong>Confirm the property location</strong><span>The map will not infer a building from its postcode.</span></div>}<div className="map-caveat"><Info size={16} /><div><strong>Indicative context only</strong><span>Boundary, planning, heritage and flood data do not constitute a legal boundary, formal search result or professional advice.</span></div></div></section><aside className="map-rail"><section className="panel"><div className="panel-header"><h2>Map layers</h2></div><div className="layer-list">{[...environment, ...planning].map((snapshot) => <div className="layer-row" key={snapshot.id}><i style={{ background: snapshot.sourceKey === "ea_flood_zone_3" ? "#1d4ed8" : snapshot.sourceKey === "ea_flood_zone_2" ? "#60a5fa" : snapshot.sourceKey === "hmlr_inspire" ? "#dc2626" : snapshot.sourceKey === "historic_england" ? "#7c3aed" : "#3b82f6" }} /><div><strong>{sourceMap.get(snapshot.sourceKey)?.name ?? snapshot.sourceKey}</strong><span>{statusLabel[snapshot.resultStatus] ?? snapshot.resultStatus}</span></div></div>)}{!environment.length && !planning.length ? <div className="empty-state compact"><span>No checked map layers yet.</span></div> : null}</div></section><section className="panel"><div className="panel-header"><h2>Source status</h2></div><SourceList sources={intelligence.sources} snapshots={intelligence.snapshots} compact /></section></aside></div> : null}
    {activeTab === "History" ? <section className="panel"><div className="panel-header"><div><h2>Property history</h2><p>Surveynt activity only; sales history is not enabled</p></div></div><ol className="property-history">{events.map((event) => <li key={event.id}><History size={15} /><div><strong>{event.action.replaceAll(".", " ")}</strong><time>{formatDate(event.occurredAt)}</time></div></li>)}{!events.length ? <li><History size={15} /><div><strong>No property events recorded</strong></div></li> : null}</ol></section> : null}
    {activeTab === "Sources" ? <section className="panel"><div className="panel-header"><div><h2>Sources and coverage</h2><p>Provenance, freshness, limitations and original documentation</p></div></div><SourceList sources={intelligence.sources} snapshots={intelligence.snapshots} /></section> : null}

    {identityOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIdentityOpen(false); }}><section className="modal identity-modal" role="dialog" aria-modal="true" aria-labelledby="identity-title"><div className="modal-header"><div><h2 id="identity-title">Resolve property identity</h2><p>Search explicitly or enter coordinates manually. Every UPRN requires confirmation.</p></div><button className="icon-button" aria-label="Close identity resolver" onClick={() => setIdentityOpen(false)}><X size={16} /></button></div><form className="identity-search" onSubmit={search}><label htmlFor="address-query">Submitted address search</label><div><input id="address-query" className="input" value={query} onChange={(event) => setQuery(event.target.value)} minLength={3} maxLength={200} autoFocus /><button className="button button-secondary" disabled={searching}><SearchCheck size={15} />{searching ? "Searching…" : "Search"}</button></div><p>Search is not autocomplete. Coverage is incomplete and manual entry remains available.</p></form>{candidates.length && !resolution ? <div className="candidate-list">{candidates.map((candidate) => <button key={`${candidate.providerKey}:${candidate.sourceRecordId}`} onClick={() => resolve(candidate)}><strong>{candidate.displayLabel}</strong><span>{candidate.precision} · {candidate.attribution}</span></button>)}</div> : null}<form onSubmit={confirmIdentity}><div className="form-section"><div className="form-grid"><div className="field"><label htmlFor="identity-latitude">Latitude</label><input id="identity-latitude" name="latitude" className="input" type="number" step="any" required defaultValue={resolution?.location.latitude ?? property.latitude ?? ""} key={`lat-${resolution?.location.latitude}`} /></div><div className="field"><label htmlFor="identity-longitude">Longitude</label><input id="identity-longitude" name="longitude" className="input" type="number" step="any" required defaultValue={resolution?.location.longitude ?? property.longitude ?? ""} key={`lng-${resolution?.location.longitude}`} /></div><div className="field full"><label htmlFor="identity-uprn">Confirmed UPRN</label><select id="identity-uprn" name="uprn" className="input" defaultValue={property.uprn ?? ""}><option value="">No UPRN confirmed</option>{resolution?.uprnCandidates.map((candidate) => <option key={candidate.uprn} value={candidate.uprn}>{candidate.uprn} — {candidate.distanceMetres} m from selected point</option>)}</select></div></div>{resolution ? <div className="identity-warning"><ShieldCheck size={17} /><span>{resolution.warning}</span></div> : null}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setIdentityOpen(false)}>Cancel</button><button className="button button-primary"><CheckCircle2 size={15} />Confirm identity</button></div></form></section></div> : null}
  </main>;
}

function SnapshotView({ title, description, snapshots, loading, sourceMap }: { title: string; description: string; snapshots: Snapshot[]; loading: boolean; sourceMap: Map<string, Source> }) {
  return <section className="panel"><div className="panel-header"><div><h2>{title}</h2><p>{description}</p></div></div>{loading ? <div className="empty-state"><span>Loading source status…</span></div> : snapshots.length ? <div className="intelligence-list">{snapshots.map((snapshot) => <article key={snapshot.id} className="intelligence-row"><div className="intelligence-icon">{snapshot.informationClass === "indicative_external_context" ? <LandPlot size={17} /> : <FileCheck2 size={17} />}</div><div><div className="intelligence-heading"><strong>{sourceMap.get(snapshot.sourceKey)?.name ?? snapshot.sourceKey}</strong><span className={`source-state state-${snapshot.resultStatus}`}>{statusLabel[snapshot.resultStatus] ?? snapshot.resultStatus}</span></div><p>{classLabel[snapshot.informationClass] ?? snapshot.informationClass} · {snapshot.coverageStatus.replaceAll("_", " ")} coverage · {Math.round(snapshot.confidence * 100)}% match confidence</p>{snapshot.data.records?.map((record, index) => <div className="record-result" key={`${snapshot.id}-${index}`}><strong>{record.title ?? "External record"}</strong><span>{record.summary ?? "Review the original source for details."}</span></div>)}<div className="source-meta"><span>Retrieved {formatDate(snapshot.retrievedAt)}</span><span>{snapshot.attribution}</span>{snapshot.evidence?.[0] ? <a href={snapshot.evidence[0].url} target="_blank" rel="noreferrer">Evidence <ExternalLink size={12} /></a> : null}</div></div></article>)}</div> : <div className="empty-state"><SearchCheck size={22} /><strong>Not checked</strong><span>Confirm the property identity, then refresh intelligence.</span></div>}</section>;
}

function SourceList({ sources, snapshots, compact = false }: { sources: Source[]; snapshots: Snapshot[]; compact?: boolean }) {
  const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.sourceKey, snapshot]));
  return <div className={compact ? "source-list compact" : "source-list"}>{sources.map((source) => { const snapshot = snapshotMap.get(source.key); return <article key={source.key}><div className="source-mark"><ShieldCheck size={15} /></div><div><strong>{source.name}</strong><span>{source.organisation}</span>{!compact ? <p>{source.limitations ?? "Review the original source documentation for coverage and reuse terms."}</p> : null}</div><div className="source-status"><span className={`source-state state-${snapshot?.resultStatus ?? "not_configured"}`}>{statusLabel[snapshot?.resultStatus ?? "not_configured"]}</span><time>{snapshot ? formatDate(snapshot.retrievedAt) : "Never checked"}</time>{!compact ? <a href={source.documentationUrl} target="_blank" rel="noreferrer">Documentation <ExternalLink size={12} /></a> : null}</div></article>; })}</div>;
}
