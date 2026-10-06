import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import Link from "next/link";
import Image from "next/image";
import { DemoLauncher } from "@/components/demo-launcher";
import { BriefcaseBusiness, CalendarDays, CirclePoundSterling, Users } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { jobStageLabels } from "@surveynt/domain";
import { PageHeader } from "@/components/page-header";
import { loadOverview } from "@/lib/data";
import { requireFirmAccess } from "@/lib/access";
import { MyWork } from "@/components/my-work";
import { redirect } from "next/navigation";

export const metadata = { title: "Overview" };

const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

export default async function OverviewPage({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params; await requireWorkspacePageAccess(organisationSlug, "overview");
  const access = await requireFirmAccess(organisationSlug);
  if (access.userRole === "finance") redirect(`/app/${organisationSlug}/finance`);
  if (access.userRole === "surveyor") return <MyWork slug={organisationSlug} />;
  const [context, overview] = await Promise.all([
    requireFirmAccess(organisationSlug),
    loadOverview(organisationSlug),
  ]);
  const firstName = context.userName.split(/\s+/)[0];
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" }).format(new Date());
  const metrics = [
    { label: "Active jobs", value: String(overview.activeJobs), foot: "Current live workload", icon: BriefcaseBusiness, href: `/app/${organisationSlug}/jobs` },
    { label: "Inspections this week", value: String(overview.inspectionsThisWeek), foot: "Confirmed appointments", icon: CalendarDays, href: `/app/${organisationSlug}/calendar` },
    { label: "Customers", value: String(overview.openClients), foot: "Active customer records", icon: Users, href: `/app/${organisationSlug}/customers` },
    { label: "Fees in progress", value: currency.format(overview.feesInProgress), foot: "Across active work", icon: CirclePoundSterling, href: `/app/${organisationSlug}/jobs` },
  ];

  return <main className="page">
    <PageHeader eyebrow={today} title={`Welcome back, ${firstName}.`} description={`Here is the current operational picture for ${context.organisationName}.`} />
    {context.internalUserId === null ? <p className="notice">Local design preview: fictional fixtures, not a persistent stakeholder practice. Sign in to create the private demo.</p> : null}
    <section className="metric-grid" aria-label="Practice summary">
      {metrics.map((metric) => <Link className="metric" key={metric.label} href={metric.href}><div className="metric-head"><span>{metric.label}</span><span className="metric-icon"><metric.icon /></span></div><div className="metric-value">{metric.value}</div><div className="metric-foot"><strong>{metric.foot}</strong></div></Link>)}
    </section>
    <div className="dashboard-grid">
      <div>
        <section className="panel">
          <div className="onboarding"><div className="onboarding-line"><strong>Complete your practice setup</strong><span>{overview.onboardingProgress}%</span></div><div className="progress"><span style={{ width: `${overview.onboardingProgress}%` }} /></div></div>
          <div className="panel-header"><div><h2>Work queue</h2><p>Recently updated jobs requiring attention</p></div><Link className="panel-link" href={`/app/${organisationSlug}/jobs`}>View all jobs →</Link></div>
          {overview.workQueue.length ? <ul className="queue-list">
            {overview.workQueue.map((job) => <li className="queue-item" key={job.id}><span className={`queue-line ${job.priority === "High" ? "red" : ""}`} /><div><Link href={`/app/${organisationSlug}/jobs/${job.id}`}><strong>{job.address}</strong></Link><span>{job.reference} · {job.service} · {job.assignee}</span></div><div className="queue-date"><StatusDot tone={job.priority === "High" ? "red" : "blue"}>{jobStageLabels[job.stage]}</StatusDot><span>{job.target}</span></div></li>)}
          </ul> : <div className="empty-state"><strong>No jobs need attention</strong><span>Create a job to start building your practice work queue.</span></div>}
        </section>
        {context.userRole === "owner" || context.userRole === "administrator" ? <DemoLauncher/> : null}
      </div>
      <aside>
        <section className="panel">
          <div className="panel-header"><div><h2>Today&apos;s inspections</h2><p>{today}</p></div></div>
          {overview.inspectionsToday.length ? <ul className="queue-list">
            {overview.inspectionsToday.map((job) => <li className="queue-item" key={job.id}><span className="queue-line" /><div><Link href={`/app/${organisationSlug}/jobs/${job.id}`}><strong>{job.address}</strong></Link><span>{job.service} · {job.assignee}</span></div><div className="queue-date"><strong>{job.target}</strong></div></li>)}
          </ul> : <div className="empty-state compact"><strong>No inspections today</strong><span>Your next scheduled inspections will appear here.</span></div>}
        </section>
        <section className="panel">
          <div className="panel-header"><div><h2>Every detail. One connected practice.</h2><p>From property context to a reviewed report.</p></div></div><figure className="architectural-figure"><Image src="/surveynt-architecture.webp" alt="Illustrative architectural cutaway of a British period house" width={960} height={960} sizes="(max-width: 800px) 100vw, 360px"/><figcaption>Illustrative — not a measured property model.</figcaption></figure>
          <div className="panel-header"><div><h2>Recent activity</h2><p>Latest recorded practice changes</p></div></div>
          {overview.recentActivity.length ? <div className="panel-body"><ul className="activity-list">{overview.recentActivity.map((activity) => <li className="activity-item" key={activity.id}><strong>{activity.text}</strong><time>{activity.time}</time></li>)}</ul></div> : <div className="empty-state compact"><strong>No recorded activity yet</strong><span>Audited changes will appear here.</span></div>}
        </section>
      </aside>
    </div>
  </main>;
}
