import Link from "next/link";
import { BriefcaseBusiness, CalendarDays, CirclePoundSterling, Users } from "lucide-react";
import { StatusDot } from "@fieldnote/ui";
import { jobStageLabels } from "@fieldnote/domain";
import { activities, jobs } from "@/lib/demo-data";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Overview" };

export default async function OverviewPage({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  const metrics = [
    { label: "Active jobs", value: "18", foot: "+3 this month", icon: BriefcaseBusiness },
    { label: "Inspections this week", value: "7", foot: "2 remaining", icon: CalendarDays },
    { label: "Open clients", value: "42", foot: "+8% this quarter", icon: Users },
    { label: "Fees in progress", value: "£21.4k", foot: "Across active work", icon: CirclePoundSterling },
  ];
  return <main className="page">
    <PageHeader eyebrow="Monday, 29 September" title="Good morning, Maya." description="Here is what needs your attention across North Star Surveying today." />
    <section className="metric-grid" aria-label="Practice summary">
      {metrics.map((metric) => <Link className="metric" key={metric.label} href={`/app/${organisationSlug}/jobs`}><div className="metric-head"><span>{metric.label}</span><span className="metric-icon"><metric.icon /></span></div><div className="metric-value">{metric.value}</div><div className="metric-foot"><strong>{metric.foot}</strong></div></Link>)}
    </section>
    <div className="dashboard-grid">
      <div>
        <section className="panel">
          <div className="onboarding"><div className="onboarding-line"><strong>Complete your practice setup</strong><span>86%</span></div><div className="progress"><span style={{ width: "86%" }} /></div></div>
          <div className="panel-header"><div><h2>Work queue</h2><p>Jobs requiring attention today</p></div><Link className="panel-link" href={`/app/${organisationSlug}/jobs`}>View all jobs →</Link></div>
          <ul className="queue-list">
            {jobs.slice(0, 4).map((job, index) => <li className="queue-item" key={job.id}><span className={`queue-line ${index === 1 ? "red" : index === 3 ? "amber" : ""}`} /><div><strong>{job.address}</strong><span>{job.reference} · {job.service} · {job.assignee}</span></div><div className="queue-date"><StatusDot tone={index === 1 ? "red" : index === 3 ? "amber" : "blue"}>{jobStageLabels[job.stage]}</StatusDot><span>{job.target}</span></div></li>)}
          </ul>
        </section>
        <section className="panel">
          <div className="panel-header"><div><h2>Active jobs</h2><p>Latest movement across your pipeline</p></div><Link className="panel-link" href={`/app/${organisationSlug}/jobs`}>Open pipeline →</Link></div>
          <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Job</th><th>Service</th><th>Stage</th><th>Surveyor</th><th>Target</th></tr></thead><tbody>{jobs.slice(0, 3).map((job) => <tr key={job.id}><td data-label="Job"><strong>{job.client}</strong><span className="cell-sub">{job.address}</span></td><td data-label="Service">{job.service}</td><td data-label="Stage"><StatusDot tone="blue">{jobStageLabels[job.stage]}</StatusDot></td><td data-label="Surveyor">{job.assignee}</td><td data-label="Target">{job.target}</td></tr>)}</tbody></table></div>
        </section>
      </div>
      <aside>
        <section className="panel">
          <div className="panel-header"><div><h2>Today&apos;s inspections</h2><p>Monday, 29 September</p></div></div>
          <ul className="queue-list">
            <li className="queue-item"><span className="queue-line" /><div><strong>18 Royal York Crescent</strong><span>Level 3 Building Survey · Maya Patel</span></div><div className="queue-date"><strong>13:30</strong></div></li>
            <li className="queue-item"><span className="queue-line amber" /><div><strong>Westgate House</strong><span>Commercial Survey · Oliver Grant</span></div><div className="queue-date"><strong>15:45</strong></div></li>
          </ul>
        </section>
        <section className="panel">
          <div className="panel-header"><div><h2>Recent activity</h2><p>Latest practice changes</p></div></div>
          <div className="panel-body"><ul className="activity-list">{activities.map((activity) => <li className="activity-item" key={activity.text}><strong>{activity.text.split(" ").slice(0, 2).join(" ")}</strong>{` ${activity.text.split(" ").slice(2).join(" ")}`}<time>{activity.time}</time></li>)}</ul></div>
        </section>
      </aside>
    </div>
  </main>;
}
