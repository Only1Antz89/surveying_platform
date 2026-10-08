import { and, eq, sql } from "drizzle-orm";
import { surveyFileRemovals, type TenantTransaction } from "@surveynt/db";

/** Read verified per-object evidence only after the caller authorises the owning record. */
export async function verifiedSurveyFileOriginalRemoval(tx: TenantTransaction, organisationId: string, kind: "document" | "questionnaire" | "media", id: string) {
  const key = `${kind}:${id}`;
  const [evidence] = await tx.select({ removedAt: sql<string>`${surveyFileRemovals.progress}->${key}->>'removedAt'` }).from(surveyFileRemovals).where(and(
    eq(surveyFileRemovals.organisationId, organisationId),
    sql`${surveyFileRemovals.progress}->${key}->>'state'='removed'`,
    sql`exists(select 1 from jsonb_array_elements(${surveyFileRemovals.manifest}->'objects') item where item->>'kind'=${kind} and item->>'id'=${id})`,
  )).limit(1);
  return evidence ?? null;
}

/** Batch evidence lookup for an already authorised original register. */
export async function verifiedSurveyFileOriginalRemovalDates(tx: TenantTransaction, organisationId: string, kind: "document" | "questionnaire" | "media", ids: readonly string[]) {
  if (!ids.length) return new Map<string, string>();
  if (ids.length > 5000) throw new Error("The original register exceeds the removal evidence limit.");
  const keys = ids.map(id => `${kind}:${id}`);
  const result = await tx.execute(sql`select evidence.key as "objectKey", evidence.value->>'removedAt' as "removedAt"
    from ${surveyFileRemovals} r cross join lateral jsonb_each(r.progress) evidence
    where r.organisation_id=${organisationId}::uuid and evidence.value->>'state'='removed'
    and evidence.key=any(array[${sql.join(keys.map(key => sql`${key}::text`), sql`, `)}])
    and exists(select 1 from jsonb_array_elements(r.manifest->'objects') item where item->>'kind'=${kind} and ${kind}||':'||(item->>'id')=evidence.key)`);
  const dates = new Map<string, string>();
  for (const row of result.rows) {
    if (typeof row.objectKey === "string" && typeof row.removedAt === "string") dates.set(row.objectKey.slice(kind.length + 1), row.removedAt);
  }
  return dates;
}
