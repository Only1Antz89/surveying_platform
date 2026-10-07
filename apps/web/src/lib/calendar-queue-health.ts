import {sql} from "drizzle-orm";
import type {Database} from "@surveynt/db";
export type CalendarQueueHealth={checkedAt:string;ready:number;delayed:number;processing:number;expiredClaims:number;held:number;oldestReadyAt:string|null;missingChannels:number;expiredSubscriptions:number;dueSubscriptions:number};
/** Aggregate operational counts only; no credentials, payloads or account identities. */
export async function loadCalendarQueueHealth(db:Database,now=new Date()):Promise<CalendarQueueHealth>{
 const jobs=await db.execute(sql`select
  count(*) filter (where status='queued' and available_at<=${now})::int as ready,
  count(*) filter (where status='queued' and available_at>${now})::int as delayed,
  count(*) filter (where status='processing')::int as processing,
  count(*) filter (where status='processing' and locked_until<=${now})::int as expired_claims,
  count(*) filter (where status='failed')::int as held,
  min(available_at) filter (where status='queued' and available_at<=${now}) as oldest_ready_at
  from background_jobs where queue='calendar_subscription'`);
 const connections=await db.execute(sql`select
  count(*) filter (where webhook_channel_id is null)::int as missing_channels,
  count(*) filter (where webhook_channel_id is not null and webhook_expires_at<=${now})::int as expired_subscriptions,
  count(*) filter (where webhook_channel_id is not null and (webhook_expires_at is null or webhook_expires_at<=${new Date(now.getTime()+86400000)}))::int as due_subscriptions
  from calendar_connections where status='active'`);
 const job=jobs.rows[0] as {ready:number;delayed:number;processing:number;expired_claims:number;held:number;oldest_ready_at:Date|string|null};
 const connection=connections.rows[0] as {missing_channels:number;expired_subscriptions:number;due_subscriptions:number};
 return {checkedAt:now.toISOString(),ready:job.ready,delayed:job.delayed,processing:job.processing,expiredClaims:job.expired_claims,held:job.held,oldestReadyAt:job.oldest_ready_at?new Date(job.oldest_ready_at).toISOString():null,missingChannels:connection.missing_channels,expiredSubscriptions:connection.expired_subscriptions,dueSubscriptions:connection.due_subscriptions};
}
