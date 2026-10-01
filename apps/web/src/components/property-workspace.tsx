"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { jobStageLabels } from "@surveynt/domain";
import { StatusDot } from "@surveynt/ui";
import type { PropertyWorkspaceData } from "@/lib/property-workspace";
import { PropertyIdentityPanel } from "./property-identity-panel";
import { IntelligencePanel, PropertySourcesTab } from "./intelligence-panel";

// Tabs appear only once the phase that powers them is complete.
const tabs = [
  { key: "overview", label: "Overview" },
  { key: "intelligence", label: "Intelligence" },
  { key: "planning", label: "Planning" },
  { key: "surveys", label: "Surveys" },
  { key: "sources", label: "Sources" },
] as const;
type TabKey = (typeof tabs)[number]["key"];

export function PropertyWorkspace({ slug, data, canEdit, canConfirm }: { slug: string; data: PropertyWorkspaceData; canEdit: boolean; canConfirm: boolean }) {
  const [tab, setTab] = useState<TabKey>("overview");
  const { property } = data;
  return <>
    <div className="workspace-back"><Link href={`/app/${slug}/properties`} className="button button-quiet"><ArrowLeft size={14} />All properties</Link></div>
    <header className="page-header"><div><span className="eyebrow">{property.clientName}</span><h1>{property.line1}</h1><p>{[property.line2, property.city, property.postcode].filter(Boolean).join(" · ")}</p></div></header>
    {data.demo ? <p className="address-demo-label">Demo workspace: representative records, not live data.</p> : null}
    <div className="workspace-tabs" role="tablist" aria-label="Property record sections">
      {tabs.map((item) => <button key={item.key} type="button" role="tab" id={`tab-${item.key}`} aria-controls={`panel-${item.key}`} aria-selected={tab === item.key} className={`workspace-tab ${tab === item.key ? "active" : ""}`} onClick={() => setTab(item.key)}>{item.label}</button>)}
    </div>
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {tab === "overview" ? <>
        <section className="panel"><div className="panel-header"><div><h2>Property record</h2><p>Recorded by the practice. Manual entries are never overwritten by external data.</p></div></div>
          <dl className="detail-grid">
            <div className="detail"><dt>Address line 1</dt><dd>{property.line1}</dd></div>
            <div className="detail"><dt>Address line 2</dt><dd>{property.line2 || "—"}</dd></div>
            <div className="detail"><dt>Town or city</dt><dd>{property.city}</dd></div>
            <div className="detail"><dt>Postcode</dt><dd>{property.postcode}</dd></div>
            <div className="detail"><dt>Property type</dt><dd>{property.propertyType || "Not recorded"}</dd></div>
            <div className="detail"><dt>Responsible client</dt><dd>{property.clientName}</dd></div>
          </dl>
        </section>
        <PropertyIdentityPanel propertyId={property.id} address={property} initialIdentity={data.identity} initialVersion={property.version} initialEvents={data.identityEvents} canEdit={canEdit} canConfirm={canConfirm} demo={data.demo} />
      </> : null}
      {tab === "intelligence" ? <IntelligencePanel propertyId={property.id} canRefresh={canEdit} title="Property intelligence" /> : null}
      {tab === "planning" ? <IntelligencePanel propertyId={property.id} canRefresh={canEdit} groups={["planning", "heritage"]} title="Planning and heritage" /> : null}
      {tab === "sources" ? <PropertySourcesTab propertyId={property.id} /> : null}
      {tab === "surveys" ? <section className="panel"><div className="panel-header"><div><h2>Linked jobs</h2><p>{data.jobs.length} recorded {data.jobs.length === 1 ? "instruction" : "instructions"}</p></div></div>
        {data.jobs.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Reference</th><th>Service</th><th>Stage</th><th>Target</th></tr></thead><tbody>{data.jobs.map((job) => <tr key={job.id}><td data-label="Reference"><strong>{job.reference}</strong></td><td data-label="Service">{job.serviceName}</td><td data-label="Stage"><StatusDot tone={job.stage === "paid" || job.stage === "issued" ? "green" : job.stage === "archived" ? "slate" : "blue"}>{jobStageLabels[job.stage]}</StatusDot></td><td data-label="Target">{job.targetDate ? new Date(`${job.targetDate}T12:00:00.000Z`).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/London" }) : "Not scheduled"}</td></tr>)}</tbody></table></div> : <div className="empty-state compact"><strong>No linked jobs</strong><span>New instructions for this property will appear here.</span></div>}
      </section> : null}
    </div>
  </>;
}
