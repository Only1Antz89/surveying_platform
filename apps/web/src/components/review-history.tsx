import Link from "./workspace-link";
import { StatusDot } from "@surveynt/ui";
import type { ReviewSummary } from "@/lib/review-history-model";

const when = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
const duration = (hours: number) => hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;

/** Senior review over the last 90 days: where reports wait and why they are sent back. */
export function ReviewHistory({ summary, slug, preview }: { summary: ReviewSummary; slug: string; preview: boolean }) {
  return <div className="stack">
    {preview ? <p className="demo-banner">Fictional preview figures.</p> : null}
    <div className="stat-card-grid" aria-label="Review summary, last 90 days">
      <div className="stat-card"><span className="stat-card-label">Sent for review</span><div className="stat-card-value">{summary.submitted}</div></div>
      <div className="stat-card"><span className="stat-card-label">Returned for changes</span><div className="stat-card-value">{summary.returned}{summary.returnRate != null ? <small> · {summary.returnRate}%</small> : null}</div></div>
      <div className="stat-card"><span className="stat-card-label">Issued after review</span><div className="stat-card-value">{summary.issued}</div></div>
      <div className="stat-card"><span className="stat-card-label">Median time in review</span><div className="stat-card-value">{summary.medianReviewHours != null ? duration(summary.medianReviewHours) : "—"}</div></div>
    </div>
    <section className="panel"><div className="panel-header"><div><h2>Waiting for review</h2><p>Reports currently with a reviewer, longest first.</p></div></div>
      {summary.waiting.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Job</th><th>Sent</th><th>Waiting</th></tr></thead><tbody>{summary.waiting.map((item) => <tr key={item.jobId}><td><Link href={`/app/${slug}/jobs/${item.jobId}`}>{item.reference}</Link></td><td>{when(item.since)}</td><td><StatusDot tone={item.hours > 72 ? "red" : item.hours > 24 ? "amber" : "green"}>{duration(item.hours)}</StatusDot></td></tr>)}</tbody></table></div> : <div className="empty-state compact"><strong>Nothing is waiting</strong><span>Reports appear here when they move to internal review.</span></div>}
    </section>
    <section className="panel"><div className="panel-header"><div><h2>Returned for changes</h2><p>The reason recorded when a reviewer sent a report back.</p></div></div>
      {summary.returns.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Job</th><th>Returned</th><th>Reason</th></tr></thead><tbody>{summary.returns.map((item) => <tr key={`${item.jobId}-${item.at}`}><td><Link href={`/app/${slug}/jobs/${item.jobId}`}>{item.reference}</Link></td><td>{when(item.at)}{item.actor ? <span className="cell-sub">{item.actor}</span> : null}</td><td>{item.reason ?? <span className="muted">No reason recorded</span>}</td></tr>)}</tbody></table></div> : <div className="empty-state compact"><strong>No returns in the last 90 days</strong></div>}
    </section>
  </div>;
}
