import { sql } from "drizzle-orm";
import { createDatabase, withTenant } from "@surveynt/db";

export async function practiceInsights(organisationId: string, from: Date, to: Date) {
  return withTenant(createDatabase(), organisationId, async tx => {
    const [conversion, money, pipeline, workload, services, completion] = await Promise.all([
      tx.execute(sql`select count(*)::int quotes, count(*) filter(where job_id is not null)::int converted from customer_quotes where organisation_id=${organisationId} and created_at>=${from} and created_at<${to}`),
      tx.execute(sql`with receipts as (
        select currency, sum(amount_minor)::bigint received from client_payments
        where organisation_id=${organisationId} and succeeded_at>=${from} and succeeded_at<${to} group by currency
      ), refunds as (
        select currency, sum(amount)::bigint refunded from (
          select currency, -amount_minor::bigint amount from settlement_ledger
          where organisation_id=${organisationId} and entry_type in ('refund','refund_liability_adjustment') and created_at>=${from} and created_at<${to}
          union all
          select p.currency, r.amount_minor::bigint amount from manual_payment_reviews r join client_payments p on p.id=r.payment_id and p.organisation_id=r.organisation_id
          where r.organisation_id=${organisationId} and r.kind='refund' and r.occurred_at>=${from} and r.occurred_at<${to}
        ) refunds_by_source group by currency
      ), billed as (
        select currency, sum(total_minor)::bigint billed from invoices where organisation_id=${organisationId}
        and status not in ('draft','void') and issued_at>=${from} and issued_at<${to} group by currency
      ), credits as (
        select i.currency,sum(c.amount_minor)::bigint credited from invoice_credits c join invoices i on i.id=c.invoice_id and i.organisation_id=c.organisation_id
        where c.organisation_id=${organisationId} and c.created_at>=${from} and c.created_at<${to} group by i.currency
      ), paid as (
        select invoice_id, sum(amount_minor-refunded_minor)::bigint received from client_payments
        where organisation_id=${organisationId} and status in ('succeeded','partially_refunded','refunded') group by invoice_id
      ), outstanding as (
        select i.currency, sum(greatest(0,i.total_minor-coalesce((select sum(c.amount_minor) from invoice_credits c where c.invoice_id=i.id and c.organisation_id=i.organisation_id),0)-coalesce(p.received,0)))::bigint outstanding
        from invoices i left join paid p on p.invoice_id=i.id where i.organisation_id=${organisationId} and i.status not in ('draft','void') group by i.currency
      ), currencies as (select currency from receipts union select currency from refunds union select currency from billed union select currency from outstanding union select currency from credits)
      select c.currency, coalesce(r.received,0) received, coalesce(f.refunded,0) refunded, coalesce(b.billed,0) billed, coalesce(cr.credited,0) credited, coalesce(o.outstanding,0) outstanding
      from currencies c left join receipts r using(currency) left join refunds f using(currency) left join billed b using(currency) left join outstanding o using(currency) left join credits cr using(currency) order by c.currency`),
      tx.execute(sql`select stage, count(*)::int count from jobs where organisation_id=${organisationId} and stage<>'archived' group by stage order by stage`),
      tx.execute(sql`select coalesce(nullif(trim(concat(u.first_name,' ',u.last_name)),''),'Unassigned') name, count(*)::int count
        from jobs j left join users u on u.id=j.assigned_surveyor_id where j.organisation_id=${organisationId} and j.stage not in ('paid','archived') group by j.assigned_surveyor_id,u.first_name,u.last_name order by count desc`),
      tx.execute(sql`select service_name name, count(*)::int count from jobs where organisation_id=${organisationId} and created_at>=${from} and created_at<${to} group by service_name order by count desc`),
      tx.execute(sql`with issued as (select job_id,min(created_at) issued_at from job_stage_events where organisation_id=${organisationId} and to_stage='issued' group by job_id)
        select count(*)::int count, avg(extract(epoch from (i.issued_at-j.created_at))/86400)::float days from issued i join jobs j on j.id=i.job_id and j.organisation_id=${organisationId}
        where i.issued_at>=${from} and i.issued_at<${to} and i.issued_at>=j.created_at`),
    ]);
    const cohort=conversion.rows[0] as {quotes:number;converted:number};
    const duration=completion.rows[0] as {count:number;days:number|null};
    return {
      from:from.toISOString(),to:to.toISOString(),quotes:cohort.quotes,converted:cohort.converted,
      conversionPercent:cohort.quotes?Math.round(cohort.converted/cohort.quotes*100):null,
      money:money.rows.map(row=>({currency:String(row.currency),receivedMinor:Number(row.received),refundedMinor:Number(row.refunded),billedMinor:Number(row.billed),creditedMinor:Number(row.credited),outstandingMinor:Number(row.outstanding)})),
      pipeline:pipeline.rows.map(row=>({name:String(row.stage),count:Number(row.count)})),
      workload:workload.rows.map(row=>({name:String(row.name),count:Number(row.count)})),
      services:services.rows.map(row=>({name:String(row.name),count:Number(row.count)})),
      completion:{count:duration.count,days:duration.days===null?null:Number(duration.days)},
    };
  });
}
export type PracticeInsights=Awaited<ReturnType<typeof practiceInsights>>;
