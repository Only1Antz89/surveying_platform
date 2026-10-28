import Link from "next/link";
import { requirePlatformAccess } from "@/lib/access";
import { canReadBusinessReports } from "@/lib/platform-report-query";
import { loadPlatformReport } from "@/lib/platform-reports";
import { loadTenants } from "@/lib/data";
export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const c = await requirePlatformAccess(),
    params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams))
    if (typeof v === "string") params.set(k, v);
  const finance = canReadBusinessReports(c.role);
  if (!finance) params.set("view", "operations");
  let report;
  try {
    report = await loadPlatformReport(
      params,
      c.role,
      c.userId === "demo_platform_user",
    );
  } catch {
    return (
      <main className="page">
        <h1>Reports</h1>
        <p role="alert">
          The report could not load. Check your dates and filters, or try again.
        </p>
        <Link href="/platform/reports">Reset filters</Link>
      </main>
    );
  }
  const tenants = await loadTenants(),
    { query, customers, trend } = report;
  const business = query.view === "business";
  const total = (
    key: "members" | "seats" | "jobs" | "user_events" | "failures",
  ) => customers.reduce((n, c) => n + Number(c[key] ?? 0), 0);
  const stats = business
    ? [
        ["Customers", customers.length],
        [
          "Active subscriptions",
          customers.filter((c) => c.subscription === "active").length,
        ],
        [
          "Trials",
          customers.filter((c) => c.subscription === "trialing").length,
        ],
        ["Allocated seats", total("seats")],
        ["Active members", total("members")],
      ]
    : [
        ["Customers", customers.length],
        [
          "Onboarding incomplete",
          customers.filter((c) => !c.steps || c.completed < c.steps).length,
        ],
        ["User events in period", total("user_events")],
        ["Failures in period", total("failures")],
        ["Support sessions in period", report.supportSessions],
      ];
  const states = business
    ? [
        "active",
        "trialing",
        "past_due",
        "unpaid",
        "incomplete",
        "canceled",
        "not_configured",
      ]
    : ["provisioning", "active", "suspended", "closed"];
  const max = Math.max(
    1,
    ...states.map(
      (s) =>
        customers.filter(
          (c) =>
            (business ? (c.subscription ?? "not_configured") : c.status) === s,
        ).length,
    ),
  );
  const exportParams = new URLSearchParams(params);
  exportParams.set("format", "csv");
  const attention = business
    ? customers.filter((c) =>
        ["past_due", "unpaid", "incomplete", "not_configured"].includes(
          c.subscription ?? "not_configured",
        ),
      )
    : customers.filter(
        (c) => !c.steps || c.completed < c.steps || c.failures > 0,
      );
  const tab = (view: string) => {
    const p = new URLSearchParams(params);
    p.set("view", view);
    return `?${p}`;
  };
  return (
    <main className="page platform-console">
      <header className="console-heading">
        <div>
          <h1>Reports</h1>
          <p>Customer health, platform adoption and service operations.</p>
        </div>
        <a
          className="button button-secondary"
          href={`/api/platform/reports?${exportParams}`}
        >
          Export report CSV
        </a>
      </header>
      <nav className="console-tabs" aria-label="Report views">
        {finance ? (
          <Link
            href={tab("business")}
            aria-current={business ? "page" : undefined}
          >
            Business
          </Link>
        ) : null}
        <Link
          href={tab("operations")}
          aria-current={!business ? "page" : undefined}
        >
          Operations
        </Link>
      </nav>
      <form className="toolbar console-filters">
        <input type="hidden" name="view" value={query.view} />
        <div className="field">
          <label htmlFor="report-period">Period</label>
          <select
            id="report-period"
            className="select"
            name="period"
            defaultValue={query.period}
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Custom dates</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="report-from">From (custom)</label>
          <input
            id="report-from"
            type="date"
            name="from"
            className="input"
            defaultValue={query.from}
          />
        </div>
        <div className="field">
          <label htmlFor="report-to">To (custom)</label>
          <input
            id="report-to"
            type="date"
            name="to"
            className="input"
            defaultValue={query.to}
          />
        </div>
        <div className="field">
          <label htmlFor="report-customer">Customer</label>
          <select
            id="report-customer"
            name="customer"
            className="select"
            defaultValue={query.customer}
          >
            <option value="">All customers</option>
            {tenants
              .filter((t) => !t.isDemo || query.includeDemo)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
        <label>
          <input
            type="checkbox"
            name="demo"
            value="include"
            defaultChecked={query.includeDemo}
          />{" "}
          Include demo accounts
        </label>
        <button className="button button-primary">Apply filters</button>
      </form>
      {report.preview ? (
        <p className="console-notice">
          Local preview. Production reporting data is unavailable; no synthetic
          performance totals are shown.
        </p>
      ) : null}
      <p className="console-notice">
        Current account snapshots are separate from activity recorded{" "}
        {query.from} to {query.to}, inclusive, in Europe/London. Activity counts
        include user-attributed audit events, not automated events.
      </p>
      <div className="console-metrics">
        {stats.map(([label, value]) => (
          <div className="console-metric" key={label}>
            <span>{label}</span>
            <strong>
              {report.preview ? "—" : Number(value).toLocaleString("en-GB")}
            </strong>
          </div>
        ))}
      </div>
      <div className="console-report-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>
              {business ? "Subscription distribution" : "Account lifecycle"} ·
              current
            </h2>
          </div>
          <div className="panel-body report-bars">
            {states.map((s) => {
              const count = customers.filter(
                (c) =>
                  (business
                    ? (c.subscription ?? "not_configured")
                    : c.status) === s,
              ).length;
              return (
                <div className="report-bar" key={s}>
                  <span>{s.replaceAll("_", " ")}</span>
                  <div className="report-bar-track">
                    <span style={{ width: `${(count / max) * 100}%` }} />
                  </div>
                  <strong>{count}</strong>
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>
              {business
                ? "Business metrics coverage"
                : "Service operations in period"}
            </h2>
          </div>
          <div className="panel-body">
            {business ? (
              <>
                <p>
                  Subscription states, seat allocations and member counts come
                  from synchronised platform records.
                </p>
                <p>
                  Revenue, historical conversion rates and historical seat
                  utilisation are unavailable in this report.
                </p>
                <Link href="/platform/billing">Open billing workflows</Link>
              </>
            ) : (
              <>
                <p>
                  {report.incidents.reduce((n, i) => n + Number(i.count), 0)}{" "}
                  incidents started in the selected period.
                </p>
                {report.incidents.map((i) => (
                  <p key={i.status}>
                    {i.status}: {i.count}
                  </p>
                ))}
                <p>
                  Incident status is current. Shared platform incidents are
                  included when no customer is selected.
                </p>
                <Link href="/platform/incidents">
                  Review incidents and background jobs
                </Link>
              </>
            )}
          </div>
        </section>
      </div>
      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-header">
          <div>
            <h2>
              {business ? "Billing attention" : "Customers needing attention"}
            </h2>
            <p>
              {business
                ? "Current subscription issues"
                : "Incomplete onboarding and failures recorded in the selected period"}
            </p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>{business ? "Billing" : "Onboarding"}</th>
                <th>Members</th>
                <th>Jobs · current</th>
                <th>Activity · period</th>
              </tr>
            </thead>
            <tbody>
              {attention.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/platform/tenants/${c.id}`}>{c.name}</Link>
                  </td>
                  <td>
                    {business
                      ? c.subscription
                      : `${c.completed}/${c.steps} steps · ${c.failures} failures`}
                  </td>
                  <td>{c.members}</td>
                  <td>
                    {c.active_jobs} active / {c.jobs} total
                  </td>
                  <td>{c.user_events} user events</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!attention.length ? (
          <p className="panel-body">
            No matching accounts currently need attention.
          </p>
        ) : null}
      </section>
      {business ? (
        <section className="panel" style={{ marginTop: 24 }}>
          <div className="panel-header">
            <h2>Trials ending in the next 14 days</h2>
          </div>
          <div className="panel-body">
            {customers
              .filter(
                (c) =>
                  c.subscription === "trialing" &&
                  c.trial_ends &&
                  new Date(c.trial_ends) >= new Date(report.asOf) &&
                  new Date(c.trial_ends).getTime() <
                    new Date(report.asOf).getTime() + 14 * 86400000,
              )
              .map((c) => (
                <p key={c.id}>
                  <Link href={`/platform/tenants/${c.id}`}>{c.name}</Link> ·{" "}
                  {new Date(c.trial_ends!).toLocaleDateString("en-GB", {
                    timeZone: "Europe/London",
                  })}
                </p>
              ))}
            <p>Only recorded trial expiry dates are included.</p>
          </div>
        </section>
      ) : null}
      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-header">
          <div>
            <h2>Recorded activity by day</h2>
            <p>Selected date range · Europe/London</p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>New customers</th>
                <th>Jobs created</th>
                <th>User audit events</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((t) => (
                <tr key={t.day}>
                  <td>{t.day}</td>
                  <td>{t.customers}</td>
                  <td>{t.jobs}</td>
                  <td>{t.user_events}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
