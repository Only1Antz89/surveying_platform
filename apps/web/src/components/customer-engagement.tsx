"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  lifecycle,
  londonDay,
  stageLabels,
  stepLabels,
  followupKinds,
} from "@/lib/customer-lifecycle";
import type { LifecycleData, Followup } from "@/lib/customer-lifecycle-data";

const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", { timeZone: "Europe/London" })
    : "No recorded activity";
export function CustomerEngagement({
  data,
  operatorId,
  query,
}: {
  data: LifecycleData;
  operatorId: string;
  query: { q: string; stage: string; attention: boolean; includeDemo: boolean };
}) {
  const router = useRouter();
  const now = new Date(data.asOf),
    today = londonDay(now);
  const [target, setTarget] = useState("");
  const [completion, setCompletion] = useState<Followup | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [requestId, setRequestId] = useState("");
  const [page, setPage] = useState(1);
  const allAccounts = data.accounts.map((a) => ({
    ...a,
    health: lifecycle(a, now),
  }));
  const matches = (text: string) =>
    text.toLowerCase().includes(query.q.toLowerCase());
  const accounts = allAccounts.filter(
    (a) =>
      matches(`${a.name} ${a.owner ?? ""}`) &&
      (!query.stage || a.health.stage === query.stage) &&
      (!query.attention || a.health.attention),
  );
  const prospects = data.prospects.filter(
    (p) =>
      matches(p.email) &&
      (!query.stage || query.stage === "prospect") &&
      (!query.attention ||
        now.getTime() - Date.parse(p.last_seen) >= 3 * 86400000),
  );
  const open = data.followups.filter((f) => !f.completed_at),
    overdue = open.filter((f) => f.due_date < today);
  const pageCount = Math.max(1, Math.ceil(accounts.length / 20)),
    currentPage = Math.min(page, pageCount);
  const rowAccounts = accounts.slice((currentPage - 1) * 20, currentPage * 20);
  const targetName = (f: Followup) =>
    f.target_type === "customer"
      ? (data.accounts.find((a) => a.id === f.target_id)?.name ?? "Customer")
      : (data.prospects.find((p) => p.id === f.target_id)?.email ??
        "Prospect (now joined or no longer eligible)");
  function plan(type: string, id: string) {
    setTarget(`${type}:${id}`);
    setRequestId(crypto.randomUUID());
    setNotice("");
    setError("");
    document
      .getElementById("engagement-followup")
      ?.scrollIntoView({ block: "center" });
    document.getElementById("followup-kind")?.focus({ preventScroll: true });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      fields = new FormData(form);
    setSaving(true);
    setError("");
    setNotice("");
    const [targetType, targetId] = target.split(":");
    const id = requestId || crypto.randomUUID();
    setRequestId(id);
    try {
      const response = await fetch("/api/platform/engagement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: id,
          targetType,
          targetId,
          kind: fields.get("kind"),
          assigneeId: fields.get("assigneeId"),
          dueDate: fields.get("dueDate"),
          note: fields.get("note"),
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw Error(payload.error?.message ?? "Follow-up could not be saved.");
      form.reset();
      setTarget("");
      setRequestId("");
      setNotice("Follow-up saved. No message has been sent to the customer.");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Follow-up could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function finish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!completion) return;
    const fields = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/platform/engagement/${completion.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outcome: fields.get("outcome"),
            note: fields.get("note"),
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw Error(payload.error?.message ?? "Outcome could not be saved.");
      setCompletion(null);
      setNotice("Outcome recorded in the audit history.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Outcome could not be saved.");
    } finally {
      setSaving(false);
    }
  }
  const exportParams = new URLSearchParams({
    format: "csv",
    q: query.q,
    stage: query.stage,
    ...(query.attention ? { attention: "yes" } : {}),
    ...(query.includeDemo ? { demo: "include" } : {}),
  });
  return (
    <>
      <header className="console-heading">
        <div>
          <h1>Customer engagement</h1>
          <p>
            Move customers from setup to subscription, support adoption and
            coordinate offboarding.
          </p>
        </div>
        <a
          className="button button-secondary"
          href={`/api/platform/engagement?${exportParams}`}
        >
          Export engagement CSV
        </a>
      </header>
      {data.preview ? (
        <p className="console-notice">
          Local preview. Demo accounts are labelled; engagement measurements and
          follow-up writes require the connected database.
        </p>
      ) : null}
      <div className="console-metrics lifecycle-metrics">
        {[
          ["Verified setup prospects", data.prospects.length],
          [
            "Stalled setup · 3+ days",
            allAccounts.filter((a) => a.health.stalled).length,
          ],
          [
            "Trial deadline · 7 days",
            allAccounts.filter((a) => a.health.trialEnding).length,
          ],
          [
            "Inactive · 14+ days",
            allAccounts.filter((a) => a.health.inactive).length,
          ],
          [
            "Offboarding / closed",
            allAccounts.filter((a) => a.health.stage === "offboarding").length,
          ],
          ["Overdue follow-ups", overdue.length],
        ].map(([label, n]) => (
          <div className="console-metric" key={label}>
            <span>{label}</span>
            <strong>{n}</strong>
          </div>
        ))}
      </div>
      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-header">
          <div>
            <h2>Where customers are now</h2>
            <p>
              Current milestones, not historical conversion rates. Setup steps
              can happen in parallel.
            </p>
          </div>
        </div>
        <div className="panel-body lifecycle-stages">
          {Object.entries(stageLabels).map(([key, label]) => (
            <Link
              key={key}
              href={`?stage=${key}${query.includeDemo ? "&demo=include" : ""}`}
              aria-current={query.stage === key ? "page" : undefined}
            >
              <strong>
                {allAccounts.filter((a) => a.health.stage === key).length}
              </strong>
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </section>
      <form
        className="toolbar console-filters"
        key={`${query.q}:${query.stage}:${query.attention}:${query.includeDemo}`}
        style={{ marginTop: 24 }}
      >
        <div className="field">
          <label htmlFor="engagement-search">Customer or owner</label>
          <input
            className="input"
            id="engagement-search"
            name="q"
            defaultValue={query.q}
            placeholder="Search name or email"
            maxLength={160}
          />
        </div>
        <div className="field">
          <label htmlFor="engagement-stage">Lifecycle</label>
          <select
            id="engagement-stage"
            name="stage"
            className="select"
            defaultValue={query.stage}
          >
            <option value="">All stages</option>
            <option value="prospect">Before workspace setup</option>
            {Object.entries(stageLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <label>
          <input
            type="checkbox"
            name="attention"
            value="yes"
            defaultChecked={query.attention}
          />{" "}
          Needs attention
        </label>
        <label>
          <input
            type="checkbox"
            name="demo"
            value="include"
            defaultChecked={query.includeDemo}
          />{" "}
          Include demos
        </label>
        <button className="button button-primary">Apply filters</button>
        <Link href="/platform/onboarding">Reset</Link>
      </form>
      <p className="console-notice">
        Stalled means no recorded member activity for 3 days during setup.
        Inactive means 14 days during trial or subscription. These are follow-up
        signals, not proof of abandonment. Dates use Europe/London.
      </p>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Customer action queue</h2>
            <p>
              {accounts.length} matching customers · next steps based on
              recorded setup, access and subscription state.
            </p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table lifecycle-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Lifecycle / setup</th>
                <th>Last activity</th>
                <th>Recommended next action</th>
                <th>Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {rowAccounts.map((a) => (
                <tr key={a.id}>
                  <td data-label="Customer">
                    <Link href={`/platform/tenants/${a.id}`}>{a.name}</Link>
                    {a.is_demo ? <span className="badge">Demo</span> : null}
                    <div className="lifecycle-muted">
                      {a.owner ?? "Owner access pending"}
                    </div>
                  </td>
                  <td data-label="Lifecycle / setup">
                    <strong>{stageLabels[a.health.stage]}</strong>
                    <div>
                      {a.health.total
                        ? `${a.health.completed}/${a.health.total} setup steps`
                        : "Setup steps not recorded"}
                    </div>
                    {a.steps.length ? (
                      <details>
                        <summary>View setup steps</summary>
                        <ul>
                          {a.steps.map((s) => (
                            <li key={s.key}>
                              {stepLabels[s.key] ?? s.key}:{" "}
                              {s.completed_at
                                ? `completed ${date(s.completed_at)}`
                                : "incomplete"}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {a.trial_ends_at ? (
                      <div>Trial deadline: {date(a.trial_ends_at)}</div>
                    ) : null}
                    {a.status === "suspended" ? (
                      <div>Account suspended</div>
                    ) : null}
                  </td>
                  <td data-label="Last activity">
                    {date(a.last_activity)}
                    <div className="lifecycle-muted">
                      {a.health.inactiveDays} days since{" "}
                      {a.last_activity ? "activity" : "account creation"}
                    </div>
                    {a.health.stalled ? (
                      <span className="badge badge-amber">Stalled setup</span>
                    ) : null}
                    {a.health.inactive ? (
                      <span className="badge badge-amber">
                        Adoption check-in
                      </span>
                    ) : null}
                  </td>
                  <td data-label="Recommended next action">
                    {a.health.nextStep}
                    <div className="lifecycle-muted">
                      {a.jobs} jobs recorded · {a.members} active members
                    </div>
                    {a.checkout_at ? (
                      <div className="lifecycle-muted">
                        Checkout created {date(a.checkout_at)}
                      </div>
                    ) : null}
                  </td>
                  <td data-label="Follow-up">
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={data.preview || saving}
                      onClick={() => plan("customer", a.id)}
                    >
                      Plan follow-up
                    </button>
                    <div className="lifecycle-muted">
                      {
                        open.filter(
                          (f) =>
                            f.target_type === "customer" &&
                            f.target_id === a.id,
                        ).length
                      }{" "}
                      open
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!accounts.length ? (
          <p className="panel-body">No customers match these filters.</p>
        ) : null}
        <div className="panel-body lifecycle-pagination">
          <button
            className="button button-secondary"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <span>
            Page {currentPage} of {pageCount}
          </span>
          <button
            className="button button-secondary"
            disabled={currentPage === pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      </section>
      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-header">
          <div>
            <h2>Before workspace setup</h2>
            <p>
              Verified users with a recorded practice-form visit and no active
              workspace membership. Internal staff and pending staff invitees
              are excluded.
            </p>
          </div>
        </div>
        <div className="panel-body">
          {prospects.length ? (
            prospects.map((p) => (
              <div className="lifecycle-prospect" key={p.id}>
                <div>
                  <strong>{p.email}</strong>
                  <div>
                    First visit {date(p.started_at)} · last visit{" "}
                    {date(p.last_seen)}
                  </div>
                </div>
                <button
                  className="button button-secondary"
                  disabled={data.preview || saving}
                  onClick={() => plan("prospect", p.id)}
                >
                  Plan follow-up
                </button>
              </div>
            ))
          ) : (
            <p>No matching verified setup prospects recorded.</p>
          )}
          <p className="lifecycle-muted">
            Measurement begins with this release. Anonymous visitors, incomplete
            Clerk signups and earlier form visits are unavailable. A setup visit
            does not establish marketing consent.
          </p>
        </div>
      </section>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="console-notice" role="status">
          {notice}
        </p>
      ) : null}
      <section
        className="panel"
        id="engagement-followup"
        style={{ marginTop: 24 }}
      >
        <div className="panel-header">
          <div>
            <h2>Plan the next conversation</h2>
            <p>
              Assign a person and deadline. This records an internal task; it
              does not send an email.
            </p>
          </div>
        </div>
        <form className="panel-body" onSubmit={save}>
          <fieldset
            disabled={data.preview || saving}
            className="lifecycle-fieldset"
          >
            <div className="form-grid">
              <div className="field">
                <label htmlFor="followup-target">Customer or prospect</label>
                <select
                  className="select"
                  id="followup-target"
                  required
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setRequestId(crypto.randomUUID());
                  }}
                >
                  <option value="">Choose an account</option>
                  <optgroup label="Customers">
                    {data.accounts.map((a) => (
                      <option key={a.id} value={`customer:${a.id}`}>
                        {a.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Verified prospects">
                    {data.prospects.map((p) => (
                      <option key={p.id} value={`prospect:${p.id}`}>
                        {p.email}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div className="field">
                <label htmlFor="followup-kind">Purpose</label>
                <select className="select" id="followup-kind" name="kind">
                  {followupKinds.map((k) => (
                    <option key={k} value={k}>
                      {k[0].toUpperCase() + k.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="followup-owner">Assigned to</label>
                <select
                  className="select"
                  id="followup-owner"
                  name="assigneeId"
                  defaultValue={operatorId}
                  required
                >
                  {data.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="followup-due">Due date · London</label>
                <input
                  className="input"
                  id="followup-due"
                  name="dueDate"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="followup-note">Next action / blocker</label>
              <textarea
                className="input"
                id="followup-note"
                name="note"
                rows={3}
                minLength={5}
                maxLength={1000}
                required
                placeholder="What is preventing progress, and what will we do next?"
              />
            </div>
            <button className="button button-primary">
              {saving ? "Saving…" : "Save follow-up"}
            </button>
          </fieldset>
        </form>
      </section>
      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-header">
          <div>
            <h2>Team follow-ups</h2>
            <p>
              {open.length} open · {overdue.length} overdue. Ordered by due
              date. History retains completed outcomes.
            </p>
          </div>
        </div>
        <div className="panel-body">
          {open
            .toSorted((a, b) => a.due_date.localeCompare(b.due_date))
            .map((f) => (
              <div className="lifecycle-task" key={f.id}>
                <div>
                  <strong>
                    {targetName(f)} · {f.kind}
                  </strong>
                  <p>{f.note}</p>
                  <span className="lifecycle-muted">
                    {f.assignee} · due {f.due_date}
                    {f.due_date < today ? " · overdue" : ""}
                  </span>
                  {f.kind === "offboarding" ? (
                    <p className="lifecycle-muted">
                      Coordinate exports, handover, billing and access removal.
                      Completing this task does not cancel a subscription or
                      delete data.
                    </p>
                  ) : null}
                </div>
                <button
                  className="button button-secondary"
                  disabled={saving}
                  onClick={() => {
                    setCompletion(f);
                    setError("");
                  }}
                >
                  Record outcome
                </button>
              </div>
            ))}
          {!open.length ? <p>No open follow-ups.</p> : null}
          {completion ? (
            <form className="lifecycle-completion" onSubmit={finish}>
              <h3>Outcome: {targetName(completion)}</h3>
              <div className="field">
                <label htmlFor="followup-outcome">Result</label>
                <select className="select" id="followup-outcome" name="outcome">
                  <option value="contacted">Contacted</option>
                  <option value="progressed">
                    Setup or subscription progressed
                  </option>
                  <option value="no_response">No response</option>
                  <option value="not_interested">Not interested</option>
                  <option value="offboarding_complete">
                    Offboarding coordination complete
                  </option>
                  <option value="cancelled">Task cancelled</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="outcome-note">Outcome notes</label>
                <textarea
                  className="input"
                  id="outcome-note"
                  name="note"
                  required
                  minLength={5}
                  maxLength={1000}
                />
              </div>
              <button className="button button-primary" disabled={saving}>
                Record outcome
              </button>{" "}
              <button
                className="button button-secondary"
                type="button"
                disabled={saving}
                onClick={() => setCompletion(null)}
              >
                Cancel
              </button>
            </form>
          ) : null}
          <details>
            <summary>
              Completed follow-up history ({data.followups.length - open.length}
              )
            </summary>
            {data.followups
              .filter((f) => f.completed_at)
              .map((f) => (
                <div className="lifecycle-task" key={f.id}>
                  <div>
                    <strong>
                      {targetName(f)} · {f.outcome?.replaceAll("_", " ")}
                    </strong>
                    <p>{f.outcome_note}</p>
                    <div className="lifecycle-muted">
                      {date(f.completed_at)} · original action: {f.note}
                    </div>
                  </div>
                </div>
              ))}
          </details>
        </div>
      </section>
      <p className="console-notice">
        Engagement is based on recorded activity and current state. Paid
        conversion history and pages visited before authentication are
        unavailable. Customer data access still requires audited support access.
      </p>
    </>
  );
}
