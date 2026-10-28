import "server-only";
import { sql } from "drizzle-orm";
import { createDatabase } from "@surveynt/db";
import { demoStore } from "./demo-store";
import { lifecycle, type LifecycleAccount } from "./customer-lifecycle";
import { platformCsv } from "./platform-csv";
export type Followup = {
  id: string;
  target_type: "customer" | "prospect";
  target_id: string;
  kind: string;
  note: string;
  assignee_id: string;
  assignee: string;
  due_date: string;
  created_at: string;
  completed_at: string | null;
  outcome: string | null;
  outcome_note: string | null;
};
export type Prospect = {
  id: string;
  email: string;
  started_at: string;
  last_seen: string;
};
export type LifecycleData = {
  preview: boolean;
  asOf: string;
  accounts: LifecycleAccount[];
  prospects: Prospect[];
  followups: Followup[];
  staff: { id: string; name: string }[];
};
export async function loadLifecycleData(
  includeDemo: boolean,
  preview = false,
): Promise<LifecycleData> {
  if (preview) {
    const state = await demoStore.snapshot();
    return {
      preview: true,
      asOf: new Date().toISOString(),
      accounts: includeDemo
        ? state.tenants.map((t) => ({
            id: t.id,
            is_demo: true,
            name: t.name,
            owner: t.owner,
            created_at: new Date().toISOString(),
            status: t.status,
            subscription: t.subscription,
            cancel_at_period_end: false,
            trial_ends_at: null,
            last_activity: t.lastActiveAt ?? null,
            steps: [],
            members: t.seats,
            jobs: 0,
            checkout_at: null,
          }))
        : [],
      prospects: [],
      followups: [],
      staff: [],
    };
  }
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [accounts, prospects, followups, staff] = await Promise.all([
    db.execute(sql`select o.id,o.is_demo,o.name,o.created_at::text,o.status::text,s.status::text as subscription,coalesce(s.cancel_at_period_end,false) as cancel_at_period_end,s.trial_ends_at::text,
      (select u.email from organisation_memberships m join users u on u.id=m.user_id where m.organisation_id=o.id and m.active and m.role='owner' order by m.created_at limit 1) as owner,
      (select max(a.occurred_at)::text from audit_events a join organisation_memberships m on m.user_id=a.actor_user_id and m.organisation_id=o.id where a.organisation_id=o.id and a.platform_staff_id is null) as last_activity,
      coalesce((select jsonb_agg(jsonb_build_object('key',key,'completed_at',completed_at) order by case key when 'practice_details' then 0 when 'billing' then 1 when 'services' then 2 when 'report_templates' then 3 when 'first_teammate' then 4 else 5 end,key) from onboarding_steps where organisation_id=o.id),'[]'::jsonb) as steps,
      (select count(*)::int from organisation_memberships where organisation_id=o.id and active) as members,
      (select count(*)::int from jobs where organisation_id=o.id) as jobs,
      (select max(occurred_at)::text from audit_events where organisation_id=o.id and action='customer.checkout_started') as checkout_at
      from organisations o left join subscriptions s on s.organisation_id=o.id where (${includeDemo} or not o.is_demo) order by o.created_at desc`),
    db.execute(
      sql`select u.id,u.email,min(a.occurred_at)::text as started_at,max(a.occurred_at)::text as last_seen from users u join audit_events a on a.actor_user_id=u.id and a.action='customer.practice_form_viewed' and a.organisation_id is null and a.platform_staff_id is null where not exists(select 1 from organisation_memberships m where m.user_id=u.id and m.active) and not exists(select 1 from platform_staff p where p.clerk_user_id=u.clerk_user_id) and not exists(select 1 from platform_staff_invitations i where lower(i.email)=lower(u.email) and i.revoked_at is null and i.expires_at>now()) group by u.id,u.email order by min(a.occurred_at)`,
    ),
    db.execute(
      sql`select c.resource_id as id,c.metadata->>'targetType' as target_type,c.metadata->>'targetId' as target_id,c.metadata->>'kind' as kind,c.metadata->>'note' as note,c.metadata->>'assigneeId' as assignee_id,coalesce(u.email,'Former platform user') as assignee,c.metadata->>'dueDate' as due_date,c.occurred_at::text as created_at,d.occurred_at::text as completed_at,d.metadata->>'outcome' as outcome,d.metadata->>'note' as outcome_note from audit_events c left join platform_staff p on p.id::text=c.metadata->>'assigneeId' left join users u on u.clerk_user_id=p.clerk_user_id left join lateral (select occurred_at,metadata from audit_events where action='platform.engagement.followup_completed' and organisation_id is null and platform_staff_id is not null and resource_id=c.resource_id order by occurred_at desc limit 1) d on true where c.action='platform.engagement.followup_created' and c.organisation_id is null and c.platform_staff_id is not null and ((c.metadata->>'targetType'='prospect') or exists(select 1 from organisations o where o.id::text=c.metadata->>'targetId' and (${includeDemo} or not o.is_demo))) order by c.occurred_at desc`,
    ),
    db.execute(
      sql`select p.id,coalesce(u.email,p.clerk_user_id) as name from platform_staff p left join users u on u.clerk_user_id=p.clerk_user_id where p.active and p.role in ('super_admin','support','billing') order by name`,
    ),
  ]);
  return {
    preview: false,
    asOf: new Date().toISOString(),
    accounts: (accounts.rows as LifecycleAccount[]).map((a) => ({
      ...a,
      created_at: new Date(a.created_at).toISOString(),
      last_activity: a.last_activity
        ? new Date(a.last_activity).toISOString()
        : null,
      checkout_at: a.checkout_at ? new Date(a.checkout_at).toISOString() : null,
      trial_ends_at: a.trial_ends_at
        ? new Date(a.trial_ends_at).toISOString()
        : null,
    })),
    prospects: (prospects.rows as Prospect[]).map((p) => ({
      ...p,
      started_at: new Date(p.started_at).toISOString(),
      last_seen: new Date(p.last_seen).toISOString(),
    })),
    followups: (followups.rows as Followup[]).map((f) => ({
      ...f,
      created_at: new Date(f.created_at).toISOString(),
      completed_at: f.completed_at
        ? new Date(f.completed_at).toISOString()
        : null,
    })),
    staff: staff.rows as LifecycleData["staff"],
  };
}
export function lifecycleCsv(data: LifecycleData) {
  return platformCsv([
    [
      "As of",
      data.asOf,
      "Current snapshot; not a historical conversion funnel",
    ],
    [
      "Customer",
      "Demo account",
      "Owner email",
      "Stage",
      "Next action",
      "Completed setup steps",
      "Recorded setup steps",
      "Last recorded member activity",
      "Checkout created",
      "Days without recorded activity",
      "Trial deadline",
      "Open follow-ups",
    ],
    ...data.accounts.map((a) => {
      const s = lifecycle(a, new Date(data.asOf));
      return [
        a.name,
        !!a.is_demo,
        a.owner,
        s.stage,
        s.nextStep,
        s.completed,
        s.total,
        a.last_activity,
        a.checkout_at,
        s.inactiveDays,
        a.trial_ends_at,
        data.followups.filter(
          (f) =>
            f.target_type === "customer" &&
            f.target_id === a.id &&
            !f.completed_at,
        ).length,
      ];
    }),
    [],
    ["Verified prospect", "First setup visit", "Last setup visit"],
    ...data.prospects.map((p) => [p.email, p.started_at, p.last_seen]),
    [],
    [
      "Follow-up",
      "Target type",
      "Target ID",
      "Kind",
      "Assignee",
      "Due date (London)",
      "Note",
      "Completed",
      "Outcome",
      "Outcome note",
    ],
    ...data.followups.map((f) => [
      f.id,
      f.target_type,
      f.target_id,
      f.kind,
      f.assignee,
      f.due_date,
      f.note,
      f.completed_at,
      f.outcome,
      f.outcome_note,
    ]),
  ]);
}

export function filterLifecycleData(
  data: LifecycleData,
  params: URLSearchParams,
): LifecycleData {
  const q = (params.get("q") ?? "").slice(0, 160).toLowerCase(),
    stage = params.get("stage") ?? "",
    attention = params.get("attention") === "yes",
    now = new Date(data.asOf);
  const accounts = data.accounts.filter((a) => {
    const state = lifecycle(a, now);
    return (
      `${a.name} ${a.owner ?? ""}`.toLowerCase().includes(q) &&
      (!stage || state.stage === stage) &&
      (!attention || state.attention)
    );
  });
  const prospects = data.prospects.filter(
    (p) =>
      p.email.toLowerCase().includes(q) &&
      (!stage || stage === "prospect") &&
      (!attention || now.getTime() - Date.parse(p.last_seen) >= 3 * 86400000),
  );
  const filtered = !!q || !!stage || attention;
  return {
    ...data,
    accounts,
    prospects,
    followups: filtered
      ? data.followups.filter((f) =>
          f.target_type === "customer"
            ? accounts.some((a) => a.id === f.target_id)
            : prospects.some((p) => p.id === f.target_id),
        )
      : data.followups,
  };
}
