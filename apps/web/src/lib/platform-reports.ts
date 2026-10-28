import { sql } from "drizzle-orm";
import { createDatabase } from "@surveynt/db";
import { canReadBusinessReports, reportQuery } from "./platform-report-query";
import { platformCsv } from "./platform-csv";
export type CustomerReport = {
  id: string;
  name: string;
  status: string;
  subscription: string | null;
  seats: number | null;
  members: number;
  steps: number;
  completed: number;
  clients: number;
  properties: number;
  jobs: number;
  active_jobs: number;
  user_events: number;
  failures: number;
  trial_ends: string | null;
};
export type PlatformReport = {
  query: ReturnType<typeof reportQuery>;
  preview: boolean;
  asOf: string;
  customers: CustomerReport[];
  trend: {
    day: string;
    customers: number;
    jobs: number;
    user_events: number;
  }[];
  incidents: { status: string; count: number }[];
  supportSessions: number;
};
export async function loadPlatformReport(
  params: URLSearchParams,
  role: string,
  demo: boolean,
): Promise<PlatformReport> {
  const query = reportQuery(params),
    financial = canReadBusinessReports(role);
  if (query.view === "business" && !financial)
    throw Error("Business reports require billing or super-admin access.");
  if (demo)
    return {
      query,
      preview: true,
      asOf: new Date().toISOString(),
      customers: [],
      trend: [],
      incidents: [],
      supportSessions: 0,
    };
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const eligible = sql`select id,name,status from organisations where (${query.includeDemo} or not is_demo) and (${query.customer}='' or id::text=${query.customer})`;
  const start = sql`(${query.from}::date::timestamp at time zone 'Europe/London')`,
    end = sql`((${query.to}::date+1)::timestamp at time zone 'Europe/London')`;
  const [accounts, trend, incidents, support] = await Promise.all([
    db.execute(sql`with eligible as (${eligible}) select o.id,o.name,o.status,
 ${financial ? sql`(select status::text from subscriptions where organisation_id=o.id limit 1)` : sql`null::text`} as subscription,
 ${financial ? sql`(select seats from subscriptions where organisation_id=o.id limit 1)` : sql`null::integer`} as seats,
 ${financial ? sql`(select trial_ends_at from subscriptions where organisation_id=o.id limit 1)` : sql`null::timestamptz`} as trial_ends,
 (select count(*)::int from organisation_memberships where organisation_id=o.id and active) as members,
 (select count(*)::int from onboarding_steps where organisation_id=o.id) as steps,
 (select count(*)::int from onboarding_steps where organisation_id=o.id and completed_at is not null) as completed,
 (select count(*)::int from clients where organisation_id=o.id) as clients,
 (select count(*)::int from properties where organisation_id=o.id) as properties,
 (select count(*)::int from jobs where organisation_id=o.id) as jobs,
 (select count(*)::int from jobs where organisation_id=o.id and stage not in ('paid','archived')) as active_jobs,
 (select count(*)::int from audit_events where organisation_id=o.id and actor_user_id is not null and occurred_at>=${start} and occurred_at<${end}) as user_events,
 (select count(*)::int from background_jobs where organisation_id=o.id and failed_at>=${start} and failed_at<${end}) as failures
 from eligible o order by o.name`),
    db.execute(
      sql`with eligible as (${eligible}), days as (select generate_series(${query.from}::date,${query.to}::date,interval '1 day')::date as day), customer_days as (select (created_at at time zone 'Europe/London')::date as day,count(*)::int as n from organisations where id in (select id from eligible) and created_at>=${start} and created_at<${end} group by 1), job_days as (select (created_at at time zone 'Europe/London')::date as day,count(*)::int as n from jobs where organisation_id in (select id from eligible) and created_at>=${start} and created_at<${end} group by 1), event_days as (select (occurred_at at time zone 'Europe/London')::date as day,count(*)::int as n from audit_events where organisation_id in (select id from eligible) and actor_user_id is not null and occurred_at>=${start} and occurred_at<${end} group by 1) select d.day::text,coalesce(c.n,0)::int as customers,coalesce(j.n,0)::int as jobs,coalesce(e.n,0)::int as user_events from days d left join customer_days c using(day) left join job_days j using(day) left join event_days e using(day) order by d.day`,
    ),
    db.execute(
      sql`with eligible as (${eligible}) select status::text,count(*)::int as count from platform_incidents i where started_at>=${start} and started_at<${end} and (exists(select 1 from platform_incident_organisations x where x.incident_id=i.id and x.organisation_id in (select id from eligible)) or (${query.customer}='' and not exists(select 1 from platform_incident_organisations x where x.incident_id=i.id))) group by status`,
    ),
    db.execute(
      sql`with eligible as (${eligible}) select count(*)::int as count from support_sessions where organisation_id in (select id from eligible) and created_at>=${start} and created_at<${end}`,
    ),
  ]);
  return {
    query,
    preview: false,
    asOf: new Date().toISOString(),
    customers: accounts.rows as CustomerReport[],
    trend: trend.rows as PlatformReport["trend"],
    incidents: incidents.rows as PlatformReport["incidents"],
    supportSessions: Number(support.rows[0]?.count ?? 0),
  };
}
export function reportCsv(report: PlatformReport) {
  const { query } = report;
  const rows: unknown[][] = [
    [
      "View",
      query.view,
      "From",
      query.from,
      "To",
      query.to,
      "Timezone",
      "Europe/London",
      "Include demos",
      query.includeDemo,
    ],
    [
      "Current customer snapshot; user events and failures are for the selected date range",
    ],
    [
      "Customer",
      "Account status",
      ...(query.view === "business"
        ? ["Subscription", "Seats", "Trial ends"]
        : []),
      "Active members",
      "Onboarding completed",
      "Onboarding total",
      "Clients",
      "Properties",
      "Jobs",
      "Active jobs",
      "User events in period",
      "Failures in period",
    ],
    ...report.customers.map((c) => [
      c.name,
      c.status,
      ...(query.view === "business"
        ? [c.subscription, c.seats, c.trial_ends]
        : []),
      c.members,
      c.completed,
      c.steps,
      c.clients,
      c.properties,
      c.jobs,
      c.active_jobs,
      c.user_events,
      c.failures,
    ]),
    [],
    ["Date (London)", "New customers", "Jobs created", "User audit events"],
    ...report.trend.map((t) => [t.day, t.customers, t.jobs, t.user_events]),
    [],
    ["Incidents started in period: current status", "Count"],
    ...report.incidents.map((i) => [i.status, i.count]),
    ["Support sessions created in period", report.supportSessions],
  ];
  return platformCsv(rows);
}
