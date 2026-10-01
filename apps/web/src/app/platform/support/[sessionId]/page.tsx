import { notFound } from "next/navigation";
import { Clock3, ShieldCheck } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { PageHeader } from "@/components/page-header";
import { loadSupportSessionView } from "@/lib/data";

export const metadata = { title: "Support session" };

export default async function SupportSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const view = await loadSupportSessionView(sessionId);
  if (!view) notFound();
  const activeClients = view.clients.filter((client) => !client.archivedAt);
  const activeProperties = view.properties.filter((property) => !property.archivedAt);
  return <main className="page">
    <div className="support-banner"><ShieldCheck />Support access active · {view.session.ticketReference} · {view.session.breakGlass ? "Emergency write" : view.session.permission === "read" ? "Read only" : "Approved write"} · Expires {new Date(view.session.expiresAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" })}</div>
    <PageHeader eyebrow="Controlled support access" title={view.organisation.name} description={view.session.reason} actions={<StatusDot tone="blue">Audited session</StatusDot>} />
    <div className="metrics-grid"><div className="metric"><span>Active members</span><strong>{view.members.filter((member) => member.active).length}</strong><small>Organisation access</small></div><div className="metric"><span>Clients</span><strong>{activeClients.length}</strong><small>Active records</small></div><div className="metric"><span>Properties</span><strong>{activeProperties.length}</strong><small>Active records</small></div><div className="metric"><span>Jobs</span><strong>{view.jobs.length}</strong><small>{view.jobs.filter((job) => job.stage !== "paid" && job.stage !== "archived").length} active</small></div></div>
    <div className="dashboard-grid"><section className="panel"><div className="panel-header"><div><h2>Workspace summary</h2><p>No customer account is impersonated in this view.</p></div><Clock3 size={17} color="#3b82f6" /></div><dl className="detail-grid"><div className="detail"><dt>Status</dt><dd>{view.organisation.status}</dd></div><div className="detail"><dt>Practice type</dt><dd>{view.organisation.practiceType}</dd></div><div className="detail"><dt>Region</dt><dd>{view.organisation.region}</dd></div><div className="detail"><dt>Tenant ID</dt><dd>{view.organisation.id}</dd></div></dl></section><section className="panel"><div className="panel-header"><div><h2>Recent jobs</h2><p>Read-only operational context</p></div></div>{view.jobs.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Reference</th><th>Stage</th></tr></thead><tbody>{view.jobs.slice(0, 20).map((job) => <tr key={job.id}><td>{job.reference}</td><td>{job.stage.replaceAll("_", " ")}</td></tr>)}</tbody></table></div> : <div className="empty-state compact"><strong>No jobs</strong><span>This tenant has no job records.</span></div>}</section></div>
  </main>;
}
