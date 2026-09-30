import { notFound } from "next/navigation";
import { ArrowLeft, Building2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { canManageTenants, roleLabels } from "@fieldnote/domain";
import { StatusDot } from "@fieldnote/ui";
import { PageHeader } from "@/components/page-header";
import { TenantControls } from "@/components/tenant-controls";
import { requirePlatformAccess } from "@/lib/access";
import { loadTenantDetail } from "@/lib/data";

export const metadata = { title: "Customer account" };

const date = (value: string | null) => value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }) : "—";

export default async function TenantPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const [detail, operator] = await Promise.all([loadTenantDetail(tenantId), requirePlatformAccess()]);
  if (!detail) notFound();
  const { tenant } = detail;
  return <main className="page">
    <Link className="panel-link" href="/platform/tenants"><ArrowLeft size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />All customer accounts</Link>
    <PageHeader eyebrow={tenant.id} title={tenant.name} description={`${tenant.owner} · ${detail.region} · Created ${detail.createdAt}`} actions={<StatusDot tone={tenant.status === "active" ? "green" : tenant.status === "suspended" ? "red" : "amber"}>{tenant.status}</StatusDot>} />
    <div className="dashboard-grid"><div className="stack">
      <section className="panel"><div className="panel-header"><div><h2>Account controls</h2><p>High-impact actions require a reason and are permanently audited.</p></div><ShieldCheck size={17} color="#2563eb" /></div><div className="panel-body"><TenantControls tenantId={tenant.id} initialStatus={tenant.status} canManage={canManageTenants(operator.role)} canSupport={operator.role === "super_admin" || operator.role === "support"} canBreakGlass={operator.role === "super_admin"} /></div></section>
      <section className="panel"><div className="panel-header"><div><h2>Members</h2><p>{detail.members.filter((member) => member.active).length} active members · {detail.invitations.length} pending invitations</p></div></div>{detail.members.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Role</th><th>Status</th></tr></thead><tbody>{detail.members.map((member) => <tr key={member.id}><td data-label="Name"><strong>{member.name}</strong><span className="cell-sub">{member.email}</span></td><td data-label="Role">{roleLabels[member.role]}</td><td data-label="Status"><StatusDot tone={member.active ? "green" : "slate"}>{member.active ? "Active" : "Inactive"}</StatusDot></td></tr>)}</tbody></table></div> : <div className="empty-state compact"><strong>No members</strong><span>This tenant has no synchronised organisation members.</span></div>}</section>
      {detail.invitations.length ? <section className="panel"><div className="panel-header"><div><h2>Pending invitations</h2><p>Invitations waiting for customer acceptance</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Email</th><th>Role</th><th>Expires</th></tr></thead><tbody>{detail.invitations.map((invitation) => <tr key={invitation.id}><td data-label="Email">{invitation.email}</td><td data-label="Role">{roleLabels[invitation.role]}</td><td data-label="Expires">{date(invitation.expiresAt)}</td></tr>)}</tbody></table></div></section> : null}
      <section className="panel"><div className="panel-header"><div><h2>Recent audit events</h2><p>Latest immutable activity for this tenant</p></div></div>{detail.audit.length ? <div className="panel-body"><ul className="activity-list">{detail.audit.map((event) => <li className="activity-item" key={event.id}><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.resourceType.replaceAll("_", " ")} · {event.actor}</span><time>{date(event.occurredAt)}</time></li>)}</ul></div> : <div className="empty-state compact"><strong>No audit events</strong><span>Audited tenant activity will appear here.</span></div>}</section>
    </div><aside className="stack">
      <section className="panel"><div className="panel-header"><div><h2>Organisation</h2><p>Tenant identity and branding</p></div><Building2 size={17} color="#2563eb" /></div><dl className="detail-grid"><div className="detail"><dt>Trading name</dt><dd>{detail.branding.tradingName}</dd></div><div className="detail"><dt>Practice type</dt><dd>{detail.practiceType}</dd></div><div className="detail"><dt>Region</dt><dd>{detail.region}</dd></div><div className="detail"><dt>Support email</dt><dd>{detail.branding.supportEmail || "—"}</dd></div><div className="detail"><dt>Accent colour</dt><dd>{detail.branding.accentColour}</dd></div><div className="detail"><dt>Last activity</dt><dd>{tenant.lastActive}</dd></div></dl></section>
      <section className="panel"><div className="panel-header"><h2>Subscription</h2></div><dl className="detail-grid"><div className="detail"><dt>Status</dt><dd>{detail.subscription?.status ?? "Not configured"}</dd></div><div className="detail"><dt>Plan</dt><dd>{detail.subscription?.planKey ?? "—"}</dd></div><div className="detail"><dt>Seats</dt><dd>{detail.subscription?.seats ?? "—"}</dd></div><div className="detail"><dt>Trial ends</dt><dd>{date(detail.subscription?.trialEndsAt ?? null)}</dd></div><div className="detail"><dt>Period ends</dt><dd>{date(detail.subscription?.currentPeriodEndsAt ?? null)}</dd></div><div className="detail"><dt>Grace ends</dt><dd>{date(detail.subscription?.graceEndsAt ?? null)}</dd></div></dl></section>
      <section className="panel"><div className="panel-header"><h2>Usage snapshot</h2></div><dl className="detail-grid"><div className="detail"><dt>Clients</dt><dd>{detail.usage.clients}</dd></div><div className="detail"><dt>Properties</dt><dd>{detail.usage.properties}</dd></div><div className="detail"><dt>Jobs</dt><dd>{detail.usage.jobs}</dd></div><div className="detail"><dt>Active jobs</dt><dd>{detail.usage.activeJobs}</dd></div></dl></section>
      <section className="panel"><div className="panel-header"><h2>Onboarding</h2></div>{detail.onboarding.length ? <div className="panel-body"><ul className="activity-list">{detail.onboarding.map((step) => <li className="activity-item" key={step.key}><strong>{step.key.replaceAll("_", " ")}</strong><time>{step.completedAt ? `Completed ${date(step.completedAt)}` : "Incomplete"}</time></li>)}</ul></div> : <div className="empty-state compact"><strong>No onboarding steps</strong><span>This tenant has not recorded onboarding progress.</span></div>}</section>
    </aside></div>
  </main>;
}
