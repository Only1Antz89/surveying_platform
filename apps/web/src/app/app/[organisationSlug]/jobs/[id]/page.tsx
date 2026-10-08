import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { jobStageLabels, canConfirmPropertyIdentity, isManagementRole } from "@surveynt/domain";
import { requireFirmAccess } from "@/lib/access";
import { loadJobWorkspace } from "@/lib/job-workspace";
import { PreinspectionQuestionnaire } from "@/components/preinspection-questionnaire";
import { SurveyFileRetentionReview } from "@/components/survey-file-retention-review";
export const metadata = { title: "Job record" };
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/jobs/[id]">) {
  const { organisationSlug: slug, id } = await params; await requireWorkspacePageAccess(slug, "jobs");
  const [record, access] = await Promise.all([loadJobWorkspace(slug, id), requireFirmAccess(slug)]);
  if (!record) notFound();
  const href = `/app/${slug}/jobs/${id}/survey`;
  const recording = canConfirmPropertyIdentity(access.userRole, access.canRecordSurvey);
  return <main className="page"><nav aria-label="Breadcrumb"><Link href={`/app/${slug}/jobs`}>Work / Jobs</Link> / {record.job.reference}</nav>
    <header className="page-header"><div><span className="eyebrow">{record.job.reference} · {jobStageLabels[record.job.stage]}</span><h1>{record.property.line1}</h1><p>{record.client.displayName} · {record.job.serviceName}</p></div><Link className="button button-primary" href={href}><ClipboardList size={17} />{recording ? record.survey ? "Continue survey" : "Start survey" : "View survey"}</Link></header>
    {record.preview ? <p className="demo-banner">Design preview — representative records, not persistent survey data.</p> : null}
    <section className="panel"><div className="panel-header"><h2>Inspection workspace</h2></div><div className="panel-body"><dl className="detail-grid"><div><dt>Agreed service</dt><dd>{record.job.serviceName}</dd></div><div><dt>Survey status</dt><dd>{record.survey?.status.replaceAll("_", " ") ?? "Not started"}</dd></div><div><dt>Customer</dt><dd><Link href={`/app/${slug}/customers`}>{record.client.displayName}</Link></dd></div><div><dt>Property</dt><dd><Link href={`/app/${slug}/properties/${record.property.id}`}>{[record.property.line1, record.property.city, record.property.postcode].filter(Boolean).join(", ")}</Link></dd></div></dl>{!recording ? <p>An owner must grant professional recording permission before you can enter findings. You can still manage permitted operational records.</p> : null}</div></section>
    <section className="panel"><div className="panel-header"><h2>Appointments</h2><Link href={`/app/${slug}/calendar`}>Open calendar</Link></div><div className="panel-body">{record.appointments.length ? <ul>{record.appointments.map(visit => <li key={visit.id}>{visit.startsAt.toLocaleString("en-GB", { timeZone: "Europe/London" })} · {visit.status} · <Link href={href}>Open survey</Link></li>)}</ul> : <p>No appointment has been recorded.</p>}</div></section>
    {!record.preview ? <PreinspectionQuestionnaire jobId={id} canAssociate={recording && access.accessLevel === "full"} canEdit={["owner", "administrator", "manager", "surveyor"].includes(access.userRole) && access.accessLevel === "full"}/> : null}
    {isManagementRole(access.userRole) ? <SurveyFileRetentionReview jobId={id} canEdit={access.accessLevel === "full"}/> : null}
  </main>;
}
