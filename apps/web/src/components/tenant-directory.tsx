"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, Search, ShieldCheck } from "lucide-react";
import { StatusDot } from "@fieldnote/ui";
import type { Tenant } from "@/lib/demo-data";

const statusTone = (status: Tenant["subscription"]): "green" | "blue" | "amber" | "red" | "slate" => status === "active" ? "green" : status === "trialing" ? "blue" : status === "past_due" || status === "incomplete" ? "amber" : status === "unpaid" ? "red" : "slate";

export function TenantDirectory({ tenants }: { tenants: Tenant[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All statuses");
  const visible = useMemo(() => tenants.filter((tenant) => `${tenant.name} ${tenant.owner}`.toLowerCase().includes(query.toLowerCase()) && (status === "All statuses" || tenant.subscription === status)), [tenants, query, status]);
  return <div className="split-view">
    <section className="panel">
      <div className="toolbar"><div className="search"><Search /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search firms or owners" aria-label="Search tenants" /></div><select className="select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Subscription status"><option>All statuses</option><option value="trialing">Trialing</option><option value="active">Active</option><option value="past_due">Past due</option><option value="incomplete">Incomplete</option><option value="unpaid">Unpaid</option></select><button className="button button-secondary"><Download size={15} />Export</button></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Firm</th><th>Plan</th><th>Billing</th><th>Onboarding</th><th>Last active</th></tr></thead><tbody>{visible.map((tenant, index) => <tr key={tenant.id}><td data-label="Firm"><Link href={`/platform/tenants/${tenant.id}`}><strong>{tenant.name}</strong><span className="cell-sub">{tenant.owner} · {tenant.seats} seats</span></Link></td><td data-label="Plan">{tenant.plan}</td><td data-label="Billing"><StatusDot tone={statusTone(tenant.subscription)}>{tenant.subscription.replace("_", " ")}</StatusDot></td><td data-label="Onboarding"><div style={{ minWidth: 80 }}><div className="progress"><span style={{ width: `${tenant.onboarding}%` }} /></div><span className="cell-sub">{tenant.onboarding}%</span></div></td><td data-label="Last active">{tenant.lastActive}{index === 0 ? <span className="cell-sub" style={{ color: "#2563eb" }}>Selected</span> : null}</td></tr>)}</tbody></table></div>
      <div className="table-footer"><span>{visible.length} customer accounts</span><div className="pager"><button className="active">1</button></div></div>
    </section>
    <aside className="panel inspector">
      <div className="inspector-hero"><StatusDot tone="blue">Trialing</StatusDot><h2 style={{ marginTop: 13 }}>North Star Surveying</h2><p>org_01 · Created 26 September 2026</p><div className="support-banner"><ShieldCheck />Customer data is private. Open a timed, audited support session before entering this workspace.</div></div>
      <dl className="detail-grid"><div className="detail"><dt>Owner</dt><dd>Maya Patel</dd></div><div className="detail"><dt>Plan</dt><dd>Practice · 5 seats</dd></div><div className="detail"><dt>Trial ends</dt><dd>10 Oct 2026</dd></div><div className="detail"><dt>Onboarding</dt><dd>86% complete</dd></div><div className="detail"><dt>Monthly usage</dt><dd>68% of allowance</dd></div><div className="detail"><dt>Last activity</dt><dd>2 minutes ago</dd></div></dl>
      <div className="admin-actions"><Link className="button button-primary" href="/platform/tenants/org_01">Open tenant</Link><Link className="button button-secondary" href="/platform/support">Support access</Link></div>
    </aside>
  </div>;
}
