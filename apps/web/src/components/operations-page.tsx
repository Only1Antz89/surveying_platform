import {CalendarReviewDetails} from "./calendar-review-details";
import { EmailDeliveryReview } from "./email-delivery-review";
import Link from "@/components/workspace-link";
import { CheckCircle2, type LucideIcon } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import type { PlatformQueueRow } from "@/lib/data";
import { PageHeader } from "./page-header";
import { QueueActionButton } from "./queue-action-button";

export function OperationsPage({ title, description, icon: Icon, rows, emptyMessage = "No records currently require attention." }: { title: string; description: string; icon: LucideIcon; rows: PlatformQueueRow[]; emptyMessage?: string }) {
  const hasActions = rows.some((row) => row.calendarReview || row.emailReview || row.action && (row.href || row.actionEndpoint));
  return <main className="page"><PageHeader eyebrow="Platform operations" title={title} description={description} /><section className="panel"><div className="panel-header"><div><h2>Current queue</h2><p>Live operational records for this workflow</p></div><Icon size={17} color="#3b82f6" /></div>{rows.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Account / item</th><th>Status</th><th>Detail</th>{hasActions ? <th>Action</th> : null}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td data-label="Account"><strong>{row.primary}</strong><span className="cell-sub">{row.secondary}</span></td><td data-label="Status"><StatusDot tone={row.tone ?? "slate"}>{row.state}</StatusDot></td><td data-label="Detail">{row.detail}</td>{hasActions ? <td data-label="Action">{row.calendarReview ? <CalendarReviewDetails jobId={row.id} {...row.calendarReview}/> : row.emailReview ? <EmailDeliveryReview jobId={row.id} {...row.emailReview}/> : row.actionEndpoint && row.action ? <QueueActionButton endpoint={row.actionEndpoint} label={row.action} /> : row.href && row.action ? <Link className="button button-quiet" href={row.href}>{row.action}</Link> : <span className="cell-sub">—</span>}</td> : null}</tr>)}</tbody></table></div> : <div className="empty-state"><CheckCircle2 size={28} color="#15825e" /><strong>Queue clear</strong><span>{emptyMessage}</span></div>}</section></main>;
}
