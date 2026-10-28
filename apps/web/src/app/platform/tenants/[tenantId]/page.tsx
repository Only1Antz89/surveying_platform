import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAccess, isClerkConfigured } from "@/lib/access";
import { loadTenantDetail } from "@/lib/data";
import { TenantControls } from "@/components/tenant-controls";
import { CustomerAccountForm } from "@/components/customer-account-form";
import { ConnectionsPanel } from "@/components/connections-panel";
import { roleLabels } from "@surveynt/domain";
const date = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/London",
      })
    : "—";
export const metadata = { title: "Customer account" };
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { tenantId } = await params;
  const operator = await requirePlatformAccess(),
    detail = await loadTenantDetail(tenantId);
  if (!detail) notFound();
  const { tenant } = detail;
  const tab = (await searchParams).tab ?? "overview";
  const manage = operator.role === "super_admin",
    financial = manage || operator.role === "billing";
  const tabs = [
    ["overview", "Overview"],
    ["account", "Account details"],
    ["members", "Members"],
    ...(financial ? [["billing", "Billing & usage"]] : []),
    ["activity", "Activity"],
  ];
  if (!tabs.some(([key]) => key === tab)) notFound();
  return (
    <main className="page platform-console">
      <Link className="panel-link" href="/platform/tenants">
        Back to customers
      </Link>
      <header className="console-heading">
        <div>
          <h1>{tenant.name}</h1>
          <p>
            {detail.region} · {tenant.status}
            {tenant.isDemo ? " · Demo account" : ""}
          </p>
        </div>
        <span>{tenant.owner}</span>
      </header>
      <nav className="console-tabs" aria-label="Customer account sections">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={`?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === "overview" ? (
        <>
          <div className="console-metrics">
            {[
              ["Onboarding", `${tenant.onboarding}%`],
              ["Active members", detail.members.filter((m) => m.active).length],
              ["Clients", detail.usage.clients],
              ["Jobs", detail.usage.jobs],
              ["Active jobs", detail.usage.activeJobs],
            ].map(([label, value]) => (
              <div className="console-metric" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="console-report-grid">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Account controls</h2>
                  <p>Access changes and support sessions are audited.</p>
                </div>
              </div>
              <div className="panel-body">
                <TenantControls
                  tenantId={tenant.id}
                  initialStatus={tenant.status}
                  canManage={manage}
                  canSupport={manage || operator.role === "support"}
                  canBreakGlass={manage}
                />
              </div>
            </section>
            <section className="panel">
              <div className="panel-header">
                <h2>Onboarding progress</h2>
              </div>
              <div className="panel-body">
                {detail.onboarding.length ? (
                  detail.onboarding.map((s) => (
                    <p key={s.key}>
                      {s.key.replaceAll("_", " ")} ·{" "}
                      {s.completedAt
                        ? `Completed ${date(s.completedAt)}`
                        : "Incomplete"}
                    </p>
                  ))
                ) : (
                  <p>No onboarding steps recorded.</p>
                )}
                <p>Last user activity: {tenant.lastActive}</p>
                <Link
                  href={`/platform/reports?customer=${isClerkConfigured() ? tenant.id : ""}&view=${financial ? "business" : "operations"}`}
                >
                  View customer reporting
                </Link>
              </div>
            </section>
          </div>
          {manage ? (
            <ConnectionsPanel scope="tenant" tenantId={tenant.id} />
          ) : null}
          {!isClerkConfigured() && tenant.slug ? (
            <p>
              <Link href={`/app/${tenant.slug}/clients`}>
                Open local demo workspace
              </Link>
            </p>
          ) : null}
        </>
      ) : null}
      {tab === "account" ? (
        <CustomerAccountForm
          disabled={!manage || !isClerkConfigured()}
          account={{
            id: tenant.id,
            name: tenant.name,
            tradingName: detail.branding.tradingName,
            region: detail.region,
            practiceType: detail.practiceType,
            supportEmail: detail.branding.supportEmail ?? "",
          }}
        />
      ) : null}
      {tab === "members" ? (
        <>
          <p className="console-notice">
            Customer members are shown for account administration. Customers
            manage their own team; internal Surveynt access is managed under
            Platform users.
          </p>
          <section className="panel">
            <div className="panel-header">
              <h2>Members · {detail.members.length}</h2>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.members.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{m.email}</td>
                      <td>{roleLabels[m.role]}</td>
                      <td>{m.active ? "Active" : "Inactive"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!detail.members.length ? (
              <p className="panel-body">No synchronised members.</p>
            ) : null}
          </section>
          <section className="panel" style={{ marginTop: 24 }}>
            <div className="panel-header">
              <h2>Pending owner and team invitations</h2>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.invitations.map((i) => (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td>{roleLabels[i.role]}</td>
                      <td>{date(i.expiresAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!detail.invitations.length ? (
              <p className="panel-body">No pending invitations.</p>
            ) : null}
          </section>
        </>
      ) : null}
      {tab === "billing" ? (
        <div className="console-report-grid">
          <section className="panel">
            <div className="panel-header">
              <h2>Subscription · current</h2>
            </div>
            <dl className="detail-grid">
              {[
                ["Status", detail.subscription?.status ?? "Not configured"],
                ["Plan", detail.subscription?.planKey ?? "—"],
                ["Seats", detail.subscription?.seats ?? "—"],
                ["Trial ends", date(detail.subscription?.trialEndsAt ?? null)],
                [
                  "Period ends",
                  date(detail.subscription?.currentPeriodEndsAt ?? null),
                ],
                ["Grace ends", date(detail.subscription?.graceEndsAt ?? null)],
              ].map(([label, value]) => (
                <div className="detail" key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="panel-body">
              <Link href="/platform/billing">Open billing operations</Link>
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>Usage · current</h2>
            </div>
            <dl className="detail-grid">
              {Object.entries(detail.usage).map(([key, value]) => (
                <div className="detail" key={key}>
                  <dt>{key.replace("activeJobs", "Active jobs")}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      ) : null}
      {tab === "activity" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>Recent audited activity</h2>
          </div>
          <div className="panel-body">
            {detail.audit.length ? (
              <ul className="activity-list">
                {detail.audit.map((e) => (
                  <li className="activity-item" key={e.id}>
                    <strong>{e.action.replaceAll("_", " ")}</strong>
                    <span>
                      {e.resourceType} · {e.actor}
                    </span>
                    <time>{date(e.occurredAt)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No recorded audit events.</p>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
