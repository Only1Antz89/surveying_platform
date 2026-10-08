import Link from "next/link";
import { and, asc, eq, gt, ne, notInArray } from "drizzle-orm";
import { appointments, createDatabase, jobs, properties, surveys, withTenant } from "@surveynt/db";
import { jobStageLabels } from "@surveynt/domain";
import { requireFirmAccess } from "@/lib/access";

export async function MyWork({ slug }: { slug: string }) {
  const access = await requireFirmAccess(slug);
  const data = await withTenant(createDatabase(), access.organisationId, async tx => {
    const [work, visits] = await Promise.all([
      tx.select({ id: jobs.id, reference: jobs.reference, service: jobs.serviceName, stage: jobs.stage, address: properties.line1, surveyId: surveys.id, surveyStatus: surveys.status }).from(jobs).innerJoin(properties, eq(properties.id, jobs.propertyId)).leftJoin(surveys, and(eq(surveys.jobId, jobs.id), eq(surveys.organisationId, access.organisationId), ne(surveys.status, "withdrawn"))).where(and(eq(jobs.organisationId, access.organisationId), eq(jobs.assignedSurveyorId, access.internalUserId!), notInArray(jobs.stage, ["paid", "archived"]))).orderBy(asc(jobs.targetDate)).limit(100),
      tx.select({ id: appointments.id, jobId: jobs.id, reference: jobs.reference, address: properties.line1, startsAt: appointments.startsAt }).from(appointments).innerJoin(jobs, eq(jobs.id, appointments.jobId)).innerJoin(properties, eq(properties.id, jobs.propertyId)).where(and(eq(appointments.organisationId, access.organisationId), eq(appointments.surveyorId, access.internalUserId!), eq(jobs.assignedSurveyorId, access.internalUserId!), eq(appointments.status, "confirmed"), gt(appointments.endsAt, new Date()))).orderBy(asc(appointments.startsAt)).limit(20),
    ]);
    return { work, visits };
  });
  return <main className="page"><header className="page-header"><div><span className="eyebrow">Your assigned workspace</span><h1>My work</h1><p>Upcoming visits, survey recording and reports. Only work assigned to you is shown.</p></div><Link className="button button-secondary" href={`/app/${slug}/calendar`}>My calendar</Link></header>
    <section className="panel"><div className="panel-header"><h2>Upcoming inspections</h2></div><div className="panel-body">{data.visits.length ? <ul>{data.visits.map(visit => <li key={visit.id}><strong>{visit.startsAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}</strong> · {visit.address} <Link className="button button-primary" href={`/app/${slug}/jobs/${visit.jobId}/survey`}>Open survey</Link></li>)}</ul> : <p>No upcoming inspections are assigned to you.</p>}</div></section>
    <section className="panel"><div className="panel-header"><div><h2>Assigned survey work</h2><p>Capture progress and report readiness are separate from the job stage. Device sync issues appear inside each survey.</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Property / job</th><th>Service</th><th>Stage</th><th>Survey</th><th>Action</th></tr></thead><tbody>{data.work.map(job => <tr key={job.id}><td data-label="Property"><Link href={`/app/${slug}/jobs/${job.id}`}>{job.address}</Link><span className="cell-sub">{job.reference}</span></td><td data-label="Service">{job.service}</td><td data-label="Stage">{jobStageLabels[job.stage]}</td><td data-label="Survey">{job.surveyStatus?.replaceAll("_", " ") ?? "Not started"}</td><td data-label="Action"><Link className="button button-primary" href={`/app/${slug}/jobs/${job.id}/survey`}>{job.surveyId ? "Continue survey" : "Start survey"}</Link></td></tr>)}</tbody></table>{!data.work.length ? <p className="empty-state">No active jobs are assigned to you.</p> : null}</div></section>
  </main>;
}
