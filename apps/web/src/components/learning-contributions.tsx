"use client";
import {workspaceFetch} from "@/lib/workspace-request";

import { type FormEvent, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { confirmationStatements, contributionConfirmations, contributionScopes, scopeDescriptions, scopeLabels, type ContributionScope } from "@surveynt/learning";
import type { loadLearningDashboard } from "@/lib/learning";

type Dashboard = Awaited<ReturnType<typeof loadLearningDashboard>>;

const statusLabels: Record<string, string> = {
  awaiting_privacy_review: "Awaiting privacy review", quarantined: "Held for manual privacy review", awaiting_technical_review: "Awaiting surveying review",
  approved: "Approved, not yet released", released: "Released", rejected: "Not used", withdrawn: "Withdrawn",
};
const formatDate = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

/**
 * A firm's shared-learning settings. Every scope is off by default and needs
 * its own confirmations; withdrawal is always available and takes effect at once.
 */
export function LearningContributions({ initial, jobs, canManage, canWithdraw, demo }: { initial: Dashboard; jobs: { id: string; reference: string }[]; canManage: boolean; canWithdraw: boolean; demo: boolean }) {
  const [data, setData] = useState(initial);
  const [granting, setGranting] = useState<ContributionScope | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function refresh() {
    const response = await workspaceFetch("/api/v1/learning", { cache: "no-store" });
    if (response.ok) setData((await response.json()).data);
  }

  async function send(url: string, body: unknown, done: (payload: { data?: { processed?: { message?: string } | null; withdrawal?: { message?: string } | null }; meta?: { demo?: boolean } }) => string) {
    setBusy(true); setMessage(null);
    const response = await workspaceFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) { setMessage({ tone: "error", text: [payload?.error?.message ?? "The change failed.", ...Object.values((payload?.error?.details?.fieldErrors ?? {}) as Record<string, string[]>).flat()].join(" ") }); return false; }
    setMessage({ tone: "success", text: payload?.meta?.demo ? "Demo workspace: nothing was recorded." : done(payload) });
    await refresh();
    return true;
  }

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!granting) return;
    const form = new FormData(event.currentTarget);
    if (await send("/api/v1/learning/grants", { scope: granting, status: "granted", confirmations: form.getAll("confirmations").map(String), basis: String(form.get("basis") ?? "").trim() || null }, () => "Scope granted. Only signed-off surveys are considered, and every case is reviewed before release.")) setGranting(null);
  }

  async function withdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const scope = String(form.get("scope") ?? "");
    const jobId = String(form.get("jobId") ?? "");
    if (await send("/api/v1/learning/withdrawals", { scope: scope || null, jobId: jobId || null, reason: String(form.get("reason") ?? "").trim() }, (payload) => payload.data?.processed?.message ?? "Withdrawal recorded.")) formElement.reset();
  }

  const counts = data.counts.reduce<Record<string, number>>((all, row) => ({ ...all, [row.status]: (all[row.status] ?? 0) + row.cases }), {});
  return <div className="ai-governance">
    {demo ? <p className="address-demo-label">Demo workspace: nothing is contributed or recorded.</p> : null}
    {!data.programme.active ? <div className="identity-warning learning-status"><ShieldAlert size={14} aria-hidden="true" /><div><strong>Shared learning is not active on Surveynt.</strong> Nothing from your workspace is shared, and no scope can be turned on until it is.<ul>{data.programme.reasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}</ul></div></div> : null}
    {message ? <p className={message.tone === "error" ? "form-error" : "form-success"} role="status">{message.text}</p> : null}

    <section className="panel">
      <div className="panel-header"><div><h2>How shared learning works</h2><p>Reviewed, generalised cases help every firm&apos;s assistant, including firms that never contribute. Contributing does not change the assistance you receive.</p></div></div>
      <ul className="ai-list">
        <li><strong>Policy</strong><span className="cell-sub">{data.programme.policy ? `Version ${data.programme.policy.version}${data.programme.policy.publishedAt ? `, published ${formatDate(data.programme.policy.publishedAt)}` : ""}. ${data.programme.policy.summary}` : "No contribution policy has been published."}</span></li>
        <li><strong>What could be copied</strong><span className="cell-sub">Only from surveys with a signed-off report: one building element at a time (its rating, observations and limitations) with names, addresses, references, dates and locations removed or generalised. A privacy reviewer and a surveyor review every case before release; nothing is published outside Surveynt.</span></li>
        <li><strong>Withdrawal</strong><span className="cell-sub">Withdrawing a job or a scope removes staged copies and released cases from shared use at once and ends any future training eligibility. A model already trained is not edited record by record; it is retired or retrained instead.</span></li>
      </ul>
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Contribution scopes</h2><p>Each scope is off by default and needs its own confirmations by an owner or administrator.</p></div></div>
      <ul className="ai-list">{contributionScopes.map((scope) => {
        const current = data.scopes.find((item) => item.scope === scope);
        const granted = current?.status === "granted";
        return <li key={scope}>
          <div className="wording-head"><strong>{scopeLabels[scope]}</strong><StatusDot tone={granted ? (current?.outdated ? "amber" : "green") : "slate"}>{granted ? (current?.outdated ? "Granted under an earlier policy" : "Granted") : current?.status === "revoked" ? "Revoked" : "Off"}</StatusDot>{current?.since ? <span className="cell-sub">since {formatDate(current.since)}{current.policyVersion ? ` · policy ${current.policyVersion}` : ""}</span> : null}</div>
          <span className="cell-sub">{scopeDescriptions[scope]}</span>
          {canManage && !demo ? <div className="row-actions">
            {granted ? <button type="button" className="button button-quiet danger" disabled={busy} onClick={() => { if (window.confirm(`Revoke ${scopeLabels[scope].toLowerCase()}? Material already staged for this scope is withdrawn at once.`)) void send("/api/v1/learning/grants", { scope, status: "revoked", confirmations: [], basis: null }, (payload) => payload.data?.withdrawal?.message ?? "Scope revoked."); }}>Revoke</button>
              : <button type="button" className="button button-secondary" disabled={busy || !data.programme.active} title={data.programme.active ? undefined : "Shared learning is not active"} onClick={() => setGranting(scope)}>Grant…</button>}
          </div> : null}
          {granting === scope ? <form className="form-section learning-grant" onSubmit={(event) => void grant(event)}>
            <fieldset className="field"><legend>Confirm each statement</legend>{contributionConfirmations.map((item) => <label key={item} className="check-field"><input type="checkbox" name="confirmations" value={item} required />{confirmationStatements[item]}</label>)}</fieldset>
            <div className="field"><label htmlFor={`basis-${scope}`}>Where your authority is recorded</label><input id={`basis-${scope}`} name="basis" className="input" required minLength={10} maxLength={1000} placeholder="For example: clause 12 of our terms of engagement, from 1 March 2027" /></div>
            <div className="form-actions"><button type="button" className="button button-quiet" onClick={() => setGranting(null)}>Cancel</button><button className="button button-primary" disabled={busy}>Grant {scopeLabels[scope].toLowerCase()}</button></div>
          </form> : null}
        </li>;
      })}</ul>
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Your contributions</h2><p>Counts for your firm only. Other firms&apos; contributions are never shown.</p></div></div>
      {Object.keys(counts).length ? <div className="metric-strip">{Object.entries(counts).map(([status, value]) => <div key={status}><strong>{value}</strong><span>{statusLabels[status] ?? status}</span></div>)}</div> : <p className="form-help assistant-empty">Nothing has been contributed.</p>}
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Withdrawals</h2><p>Withdraw one job (for example when a client objects) or a whole scope. Processed immediately when the learning service is running.</p></div></div>
      {data.withdrawals.length ? <ul className="ai-list">{data.withdrawals.map((item) => <li key={item.id}>
        <div className="wording-head"><strong>{item.jobReference ? `Job ${item.jobReference}` : "Whole firm"} · {item.scope ? scopeLabels[item.scope as ContributionScope] ?? item.scope : "all scopes"}</strong><StatusDot tone={item.status === "completed" ? "green" : "amber"}>{item.status === "completed" ? "Completed" : "Waiting for the learning service"}</StatusDot><span className="cell-sub">{formatDate(item.createdAt)}</span></div>
        <span className="cell-sub">{item.reason}</span>
        {typeof item.outcome?.message === "string" ? <span className="cell-sub">{item.outcome.message}</span> : null}
      </li>)}</ul> : <p className="form-help assistant-empty">No withdrawal requests.</p>}
      {canWithdraw && !demo ? <form className="form-section" onSubmit={(event) => void withdraw(event)}>
        <div className="form-grid">
          <div className="field"><label htmlFor="withdraw-job">Job</label><select id="withdraw-job" name="jobId" className="select" defaultValue=""><option value="">All jobs</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.reference}</option>)}</select></div>
          <div className="field"><label htmlFor="withdraw-scope">Scope</label><select id="withdraw-scope" name="scope" className="select" defaultValue=""><option value="">All scopes</option>{contributionScopes.map((scope) => <option key={scope} value={scope}>{scopeLabels[scope]}</option>)}</select></div>
          <div className="field full"><label htmlFor="withdraw-reason">Reason</label><input id="withdraw-reason" name="reason" className="input" required minLength={5} maxLength={1000} placeholder="For example: the client asked us not to reuse their survey" /></div>
        </div>
        <div className="form-actions"><button className="button button-secondary" disabled={busy}>Request withdrawal</button></div>
      </form> : null}
    </section>
  </div>;
}
