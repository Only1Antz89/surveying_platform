"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, Search, ShieldCheck } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import type { Tenant } from "@/lib/demo-data";

const statusTone = (status: Tenant["subscription"]): "green" | "blue" | "amber" | "red" | "slate" => status === "active" ? "green" : status === "trialing" ? "blue" : status === "past_due" || status === "incomplete" ? "amber" : status === "unpaid" ? "red" : "slate";

export function TenantDirectory({ tenants }: { tenants: Tenant[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All statuses");
  const [selectedId, setSelectedId] = useState(tenants[0]?.id ?? "");
  const visible = useMemo(() => tenants.filter((tenant) => `${tenant.name} ${tenant.owner}`.toLowerCase().includes(query.toLowerCase()) && (status === "All statuses" || tenant.subscription === status)), [tenants, query, status]);
  const selected = visible.find((tenant) => tenant.id === selectedId) ?? visible[0];
  const csv = `firm,owner,plan,organisation status,billing,seats,trial ends,onboarding,last active\n${visible.map((tenant) => [tenant.name, tenant.owner, tenant.plan, tenant.status, tenant.subscription, tenant.seats, tenant.trialEnds, `${tenant.onboarding}%`, tenant.lastActive].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n")}`;

  return <div className="split-view">
    <section className="panel">
      <div className="toolbar"><div className="search"><Search /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search firms or owners" aria-label="Search tenants" /></div><select className="select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Subscription status"><option>All statuses</option><option value="trialing">Trialing</option><option value="active">Active</option><option value="past_due">Past due</option><option value="incomplete">Incomplete</option><option value="unpaid">Unpaid</option><option value="canceled">Canceled</option></select><a className="button button-secondary" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="surveynt-tenants.csv"><Download size={15} />Export</a></div>
      {visible.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Firm</th><th>Plan</th><th>Billing</th><th>Onboarding</th><th>Last active</th></tr></thead><tbody>{visible.map((tenant) => <tr key={tenant.id} className={selected?.id === tenant.id ? "selected-row" : undefined}><td data-label="Firm"><button className="table-link-button" onClick={() => setSelectedId(tenant.id)}><strong>{tenant.name}</strong><span className="cell-sub">{tenant.owner} · {tenant.seats} seats{tenant.isDemo ? " · Demo practice" : ""}</span></button></td><td data-label="Plan">{tenant.plan}</td><td data-label="Billing"><StatusDot tone={statusTone(tenant.subscription)}>{tenant.subscription.replace("_", " ")}</StatusDot></td><td data-label="Onboarding"><div style={{ minWidth: 80 }}><div className="progress"><span style={{ width: `${tenant.onboarding}%` }} /></div><span className="cell-sub">{tenant.onboarding}%</span></div></td><td data-label="Last active">{tenant.lastActive}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No customer accounts found</strong><span>Adjust the current search or billing filter.</span></div>}
      <div className="table-footer"><span>{visible.length} customer accounts</span><div className="pager"><button className="active" aria-label="Page 1">1</button></div></div>
    </section>
    {selected ? <aside className="panel inspector">
      <div className="inspector-hero"><StatusDot tone={statusTone(selected.subscription)}>{selected.subscription.replace("_", " ")}</StatusDot><h2 style={{ marginTop: 13 }}>{selected.name}</h2><p>{selected.id} · {selected.status}</p><div className="support-banner"><ShieldCheck />Customer data is private. A timed, audited support session is required before workspace access.</div></div>
      <dl className="detail-grid"><div className="detail"><dt>Owner</dt><dd>{selected.owner}</dd></div><div className="detail"><dt>Plan</dt><dd>{selected.plan} · {selected.seats} seats</dd></div><div className="detail"><dt>Trial ends</dt><dd>{selected.trialEnds}</dd></div><div className="detail"><dt>Onboarding</dt><dd>{selected.onboarding}% complete</dd></div><div className="detail"><dt>Organisation</dt><dd>{selected.status}</dd></div><div className="detail"><dt>Last activity</dt><dd>{selected.lastActive}</dd></div></dl>
      <div className="admin-actions"><Link className="button button-primary" href={`/platform/tenants/${selected.id}`}>Open tenant</Link></div>
    </aside> : null}
  </div>;
}
