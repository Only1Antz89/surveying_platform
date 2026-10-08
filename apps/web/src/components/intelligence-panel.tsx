"use client";
import {WorkspaceAnchor} from "@/components/workspace-anchor";

import {workspaceFetch} from "@/lib/workspace-request";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { ukCountryLabels, type UkCountry } from "@surveynt/domain";
import { categoryGroupLabels, categoryInfo, informationClassLabels, providerStatusLabels, type CategoryGroup, type InformationClass, type ProviderStatus } from "@surveynt/property-data";
import type { IntelligenceCategoryView, PropertyIntelligence } from "@/lib/intelligence";

const statusTone: Record<ProviderStatus, "green" | "slate" | "amber" | "red" | "blue"> = { matched: "blue", no_match: "slate", unsupported: "slate", not_configured: "slate", unavailable: "amber", error: "red" };
const classTone: Record<InformationClass, "green" | "blue" | "amber"> = { surveyor_verified: "green", authoritative_external: "blue", indicative_external: "amber" };
const statusText: Record<ProviderStatus, string> = { ...providerStatusLabels, unsupported: "Not checked: not covered", not_configured: "Not checked" };

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "—";
}

function RecordSummary({ category, record }: { category: string; record: IntelligenceCategoryView["records"][number] }) {
  const data = record.data;
  if (category === "energy_certificate" || category === "energy_certificate_scotland") {
    return <div className="intel-record">
      <strong>Rating {String(data.currentRating ?? "—")}{data.potentialRating ? ` (potential ${String(data.potentialRating)})` : ""}{data.latest ? "" : " · earlier certificate"}</strong>
      <span className="cell-sub">Lodged {formatDate(String(data.lodgementDate ?? "") || null)} · {String(data.propertyType ?? "Type not recorded")} · {String(data.builtForm ?? "")} · {String(data.constructionAgeBand ?? "Age band not recorded")}</span>
      {data.walls ? <span className="cell-sub">Walls: {String(data.walls)}</span> : null}
    </div>;
  }
  if (category === "sales_history") {
    return <div className="intel-record">
      <strong>{new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(data.price))} · {formatDate(String(data.transferDate ?? "") || null)}</strong>
      <span className="cell-sub">{[data.propertyTypeLabel, data.tenureLabel, data.newBuild ? "New build" : null, data.ppdCategory === "B" ? "Additional price paid category" : null].filter(Boolean).map(String).join(" · ")}</span>
      {data.sharedSale ? <span className="cell-sub">Linked to {String(data.linkedUprnCount)} properties: the price covers all of them.</span> : null}
    </div>;
  }
  const attributes = (data.attributes ?? {}) as Record<string, unknown>;
  return <div className="intel-record">
    <strong>{String(data.name ?? data.label ?? record.sourceRecordId ?? "Record")}</strong>
    <span className="cell-sub">{[attributes.Grade ? `Grade ${String(attributes.Grade)}` : null, data.reference ? `Ref ${String(data.reference)}` : null, typeof data.distanceMetres === "number" && data.distanceMetres > 0 ? `${data.distanceMetres} m away` : null, data.ended ? "Ended" : null, record.confidence ? `Confidence: ${record.confidence}` : null].filter(Boolean).join(" · ")}</span>
  </div>;
}

function CategoryCard({ item }: { item: IntelligenceCategoryView }) {
  const info = categoryInfo(item.category);
  const status = item.status as ProviderStatus;
  const informationClass = item.informationClass as InformationClass;
  return <article className={`intel-card ${item.stale ? "stale" : ""}`}>
    <header>
      <h4>{info.label}</h4>
      <div className="intel-badges">
        <StatusDot tone={statusTone[status] ?? "slate"}>{statusText[status] ?? status}</StatusDot>
        <StatusDot tone={classTone[informationClass] ?? "amber"}>{informationClassLabels[informationClass] ?? informationClass}</StatusDot>
      </div>
    </header>
    {item.stale ? <p className="identity-warning"><AlertTriangle size={14} aria-hidden="true" />Retrieved for an earlier location or identity of this property. Refresh before relying on it.</p> : null}
    {!item.stale && item.newerDataAvailable ? <p className="identity-warning"><AlertTriangle size={14} aria-hidden="true" />A newer version of this dataset is now active. Refresh to check against it.</p> : null}
    {item.records.length ? <ul className="intel-records">{item.records.map((record) => <li key={record.snapshotId}><RecordSummary category={item.category} record={record} />{record.evidence.length ? <div className="intel-evidence">{record.evidence.map((evidence) => <WorkspaceAnchor key={evidence.url} href={evidence.url} target="_blank" rel="noopener noreferrer">{evidence.label}<ExternalLink size={12} aria-hidden="true" /></WorkspaceAnchor>)}</div> : null}</li>)}</ul> : null}
    {item.message ? <p className="intel-message">{item.message}</p> : null}
    <p className="intel-caveat">{info.caveat}</p>
    <footer className="cell-sub">Retrieved {formatDate(item.retrievedAt)}{item.datasetVersion ? ` · dataset ${item.datasetVersion}` : ""} · coverage {item.coverage.replace(/_/g, " ")}{item.fresh ? "" : " · due for refresh"} · {String(item.licence.attribution ?? item.licence.name ?? "")}</footer>
  </article>;
}

/** Stored property intelligence with explicit statuses; missing data is shown as not checked or no record found, never as a negative finding. */
export function IntelligencePanel({ propertyId, canRefresh, groups, title }: { propertyId: string; canRefresh: boolean; groups?: CategoryGroup[]; title: string }) {
  const [data, setData] = useState<PropertyIntelligence | null>(null);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    workspaceFetch(`/api/v1/properties/${propertyId}/intelligence`, { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json().catch(() => null) }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        setLoading(false);
        if (!response.ok) return setError(payload?.error?.message ?? "Property intelligence is unavailable. Manual records are unaffected.");
        setData(payload.data); setDemo(Boolean(payload.meta?.demo)); setError(null);
      })
      .catch(() => { if (!cancelled) { setLoading(false); setError("Property intelligence is unavailable while offline. Manual records are unaffected."); } });
    return () => { cancelled = true; };
  }, [propertyId, reloads]);
  const load = useCallback(async () => setReloads((value) => value + 1), []);

  async function refresh() {
    setRefreshing(true); setError(null);
    const response = await workspaceFetch(`/api/v1/properties/${propertyId}/intelligence/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: `ui_${crypto.randomUUID().replace(/-/g, "")}` }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) { setRefreshing(false); return setError(payload?.error?.message ?? "The refresh could not be started."); }
    const runId = payload.data.runId as string;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await workspaceFetch(`/api/v1/intelligence/runs/${runId}`, { cache: "no-store" }).then((item) => item.json()).catch(() => null);
      if (!status?.data || !["queued", "running"].includes(status.data.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    await load();
    setRefreshing(false);
  }

  if (loading) return <section className="panel"><div className="empty-state"><RefreshCw size={20} /><strong>Loading property intelligence…</strong></div></section>;
  if (!data) return <section className="panel"><div className="empty-state"><AlertTriangle size={20} /><strong>{error}</strong></div></section>;
  const visible = data.categories.filter((item) => !groups || groups.includes(categoryInfo(item.category).group));
  const grouped = new Map<CategoryGroup, IntelligenceCategoryView[]>();
  for (const item of visible) grouped.set(categoryInfo(item.category).group, [...(grouped.get(categoryInfo(item.category).group) ?? []), item]);
  const approximate = data.location.confidence === "unresolved" || data.location.confidence === "postcode_centroid";

  return <section className="panel intel-panel" aria-labelledby={`intel-${title}`}>
    <div className="panel-header"><div><h2 id={`intel-${title}`}>{title}</h2><p>{data.latestRun ? `Last refresh ${formatDate(data.latestRun.createdAt)}: ${data.latestRun.status}${data.latestRun.current ? "" : " (earlier identity)"}` : "Not refreshed yet"}. External records never overwrite surveyor observations.</p></div>
      {canRefresh ? <button type="button" className="button button-secondary" onClick={() => void refresh()} disabled={refreshing || !data.enabled}><RefreshCw size={14} className={refreshing ? "spin" : ""} />{refreshing ? "Refreshing…" : "Refresh"}</button> : null}
    </div>
    {demo ? <p className="address-demo-label intel-inline">Demo workspace: illustrative records, not live data.</p> : null}
    {!data.enabled && !demo ? <p className="identity-warning">Property intelligence is not enabled for this deployment. Stored results, if any, are shown with their dates.</p> : null}
    {approximate ? <p className="identity-warning">Location checks need an address-level or surveyor-confirmed location. Postcode centres are too approximate.</p> : null}
    {data.location.country ? <p className="form-help intel-inline">{data.sources.filter((source) => source.coversProperty).length} of {data.sources.length} registered sources cover {ukCountryLabels[data.location.country as UkCountry]}. Sources from other nations are never used for this property; see the Sources tab.</p> : <p className="identity-warning">Set the property&apos;s country to see which sources apply.</p>}
    {error ? <p className="form-error intel-inline" role="alert">{error}</p> : null}
    {visible.length ? [...grouped.entries()].map(([group, items]) => <div key={group} className="intel-group"><h3>{categoryGroupLabels[group]}</h3><div className="intel-grid">{items.map((item) => <CategoryCard key={`${item.sourceKey}-${item.category}`} item={item} />)}</div></div>) : <div className="empty-state"><strong>Not checked yet</strong><span>No source has been checked for this property. This is not the same as “no record”.</span></div>}
  </section>;
}

export function SourcesPanel({ sources }: { sources: PropertyIntelligence["sources"] }) {
  return <section className="panel" aria-labelledby="sources-heading">
    <div className="panel-header"><div><h2 id="sources-heading">Sources and licences</h2><p>Each source stays disabled until its licence, coverage and access terms are verified.</p></div></div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Source</th><th>Status</th><th>Coverage</th><th>Licence and attribution</th><th>Guardrail</th></tr></thead><tbody>
      {sources.map((source) => <tr key={source.key}>
        <td data-label="Source"><WorkspaceAnchor href={source.documentationUrl} target="_blank" rel="noopener noreferrer"><strong>{source.name}</strong></WorkspaceAnchor><span className="cell-sub">{source.organisation}</span></td>
        <td data-label="Status"><StatusDot tone={source.enabled ? "green" : source.registerStatus === "blocked" ? "red" : "slate"}>{source.enabled ? "Enabled" : source.registerStatus === "blocked" ? "Blocked (licence)" : "Disabled: awaiting verification"}</StatusDot><span className="cell-sub">Register checked {source.checkedAt}</span></td>
        <td data-label="Coverage">{source.coverage.join(", ")}<span className="cell-sub">{source.coversProperty ? "Covers this property's country" : "Does not cover this property's country"} · {source.coverageNotes}</span></td>
        <td data-label="Licence">{String(source.licence.name)}<span className="cell-sub">{String(source.licence.attribution)}</span></td>
        <td data-label="Guardrail"><span className="cell-sub">{source.guardrail}</span></td>
      </tr>)}
    </tbody></table></div>
  </section>;
}

export function PropertySourcesTab({ propertyId }: { propertyId: string }) {
  const [sources, setSources] = useState<PropertyIntelligence["sources"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    workspaceFetch(`/api/v1/properties/${propertyId}/intelligence`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) setError(payload?.error?.message ?? "Sources are unavailable.");
      else setSources(payload.data.sources);
    }).catch(() => setError("Sources are unavailable while offline."));
  }, [propertyId]);
  if (!sources) return <section className="panel"><div className="empty-state"><strong>{error ?? "Loading sources…"}</strong></div></section>;
  return <SourcesPanel sources={sources} />;
}
