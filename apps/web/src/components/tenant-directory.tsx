"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Download,
  Plus,
  Search,
} from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import type { Tenant } from "@/lib/demo-data";
import { filterCustomers, registerQuery } from "@/lib/customer-register";
import { platformCsv } from "@/lib/platform-csv";
export function TenantDirectory({
  tenants,
  canManage = false,
}: {
  tenants: Tenant[];
  canManage?: boolean;
}) {
  const params = useSearchParams(),
    router = useRouter(),
    query = registerQuery(new URLSearchParams(params.toString()));
  function change(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    router.replace(`?${next}`, { scroll: false });
  }
  function sort(key: string) {
    const next = new URLSearchParams(params.toString());
    next.set("sort", key);
    next.set(
      "direction",
      query.sort === key && query.direction === "asc" ? "desc" : "asc",
    );
    next.delete("page");
    router.replace(`?${next}`, { scroll: false });
  }
  const filtered = filterCustomers(tenants, query),
    pages = Math.max(1, Math.ceil(filtered.length / 20)),
    page = Math.min(pages, query.page),
    visible = filtered.slice((page - 1) * 20, page * 20);
  const metrics = [
    ["Total customers", tenants.length, ""],
    [
      "Active subscriptions",
      tenants.filter((t) => t.subscription === "active").length,
      "active",
    ],
    [
      "On trial",
      tenants.filter((t) => t.subscription === "trialing").length,
      "trialing",
    ],
    [
      "Onboarding incomplete",
      tenants.filter((t) => t.onboarding < 100).length,
      "provisioning",
    ],
    [
      "Billing attention",
      tenants.filter((t) =>
        ["past_due", "unpaid", "incomplete"].includes(t.subscription),
      ).length,
      "past_due",
    ],
  ] as const;
  const csv = platformCsv([
    [
      "Firm",
      "Owner",
      "Plan",
      "Account status",
      "Billing",
      "Seats",
      "Onboarding %",
      "Last user activity",
    ],
    ...filtered.map((t) => [
      t.name,
      t.owner,
      t.plan,
      t.status,
      t.subscription,
      t.plan === "Pending" ? "" : t.seats,
      t.onboarding,
      t.lastActive,
    ]),
  ]);
  function exportRows() {
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "surveynt-customers.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <header className="console-heading">
        <div>
          <h1>Customers</h1>
          <p>Manage customer accounts, onboarding and account health.</p>
        </div>
        {canManage ? (
          <Link className="button button-primary" href="/platform/tenants/new">
            <Plus size={16} />
            Add customer
          </Link>
        ) : null}
      </header>
      <div className="console-metrics">
        {metrics.map(([label, value, status]) => (
          <div className="console-metric" key={label}>
            <span>{label}</span>
            <strong>{value.toLocaleString("en-GB")}</strong>
            {status ? (
              <Link
                href={
                  label === "Onboarding incomplete"
                    ? "/platform/onboarding"
                    : label === "Billing attention"
                      ? "/platform/billing"
                      : `?status=${status}`
                }
              >
                Review <ArrowUpRight size={13} />
              </Link>
            ) : (
              <span>All accounts, including demos</span>
            )}
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="console-register-heading">
          <div>
            <h2>Customer register</h2>
            <p>{filtered.length} matching accounts</p>
          </div>
          <button className="button button-secondary" onClick={exportRows}>
            <Download size={15} />
            Export results
          </button>
        </div>
        <form
          className="toolbar console-filters"
          onSubmit={(e) => {
            e.preventDefault();
            change("q", String(new FormData(e.currentTarget).get("q") ?? ""));
          }}
        >
          <div className="search">
            <Search size={16} />
            <input
              key={query.q}
              name="q"
              className="input"
              defaultValue={query.q}
              placeholder="Search customers or owners"
              aria-label="Search customers"
            />
          </div>
          <button className="button button-secondary">Search</button>
          <select
            className="select"
            aria-label="Billing status"
            value={query.status}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="">All billing statuses</option>
            {[
              "active",
              "trialing",
              "past_due",
              "unpaid",
              "incomplete",
              "canceled",
            ].map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Account status"
            value={query.account}
            onChange={(e) => change("account", e.target.value)}
          >
            <option value="">All account statuses</option>
            {["provisioning", "active", "suspended", "closed"].map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Plan"
            value={query.plan}
            onChange={(e) => change("plan", e.target.value)}
          >
            <option value="">All plans</option>
            {Array.from(new Set(tenants.map((t) => t.plan)))
              .sort()
              .map((p) => (
                <option key={p}>{p}</option>
              ))}
          </select>
          <select
            className="select"
            aria-label="Demo accounts"
            value={query.demo}
            onChange={(e) => change("demo", e.target.value)}
          >
            <option value="">Live and demo</option>
            <option value="live">Live only</option>
            <option value="demo">Demo only</option>
          </select>
          {params.size ? (
            <Link className="button button-quiet" href="/platform/tenants">
              Clear filters
            </Link>
          ) : null}
        </form>
        <div className="data-table-wrap">
          <table className="data-table customer-table">
            <thead>
              <tr>
                {[
                  ["Customer", "name"],
                  ["Plan", "plan"],
                  ["Billing", "subscription"],
                  ["Seats", "seats"],
                  ["Onboarding", "onboarding"],
                  ["Last user activity", "lastActive"],
                ].map(([label, key]) => (
                  <th
                    key={key}
                    aria-sort={
                      query.sort === key
                        ? query.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button className="sort-heading" onClick={() => sort(key)}>
                      {label}
                      {query.sort === key ? (
                        query.direction === "asc" ? (
                          <ArrowUp size={12} />
                        ) : (
                          <ArrowDown size={12} />
                        )
                      ) : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id}>
                  <td data-label="Customer">
                    <Link
                      className="customer-name"
                      href={`/platform/tenants/${t.id}`}
                    >
                      {t.name}
                      <ArrowUpRight size={13} />
                    </Link>
                    <span className="cell-sub">
                      {t.owner}
                      {t.isDemo ? " · Demo" : ""} · {t.status}
                    </span>
                  </td>
                  <td data-label="Plan">{t.plan}</td>
                  <td data-label="Billing">
                    <StatusDot
                      tone={t.subscription === "active" ? "blue" : "slate"}
                    >
                      {t.plan === "Pending"
                        ? "Not configured"
                        : t.subscription.replaceAll("_", " ")}
                    </StatusDot>
                  </td>
                  <td data-label="Seats">
                    {t.plan === "Pending" ? "—" : t.seats}
                  </td>
                  <td data-label="Onboarding">
                    <div className="progress">
                      <span style={{ width: `${t.onboarding}%` }} />
                    </div>
                    <span className="cell-sub">{t.onboarding}% complete</span>
                  </td>
                  <td data-label="Last user activity">{t.lastActive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length ? (
          <div className="empty-state">
            <strong>No customers match these filters</strong>
            <span>Clear the filters or add a customer account.</span>
          </div>
        ) : null}
        <div className="table-footer">
          <span>
            {filtered.length
              ? `${(page - 1) * 20 + 1}–${Math.min(page * 20, filtered.length)} of ${filtered.length}`
              : "0 accounts"}
          </span>
          <div className="console-pagination">
            <button
              className="button button-secondary"
              disabled={page === 1}
              onClick={() => change("page", String(page - 1))}
            >
              Previous
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              className="button button-secondary"
              disabled={page === pages}
              onClick={() => change("page", String(page + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
