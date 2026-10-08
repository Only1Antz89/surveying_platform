import { sql } from "drizzle-orm";
// Use explicit identifiers: single-table select rendering strips Column qualification,
// which would otherwise bind id/organisation_id to the inner audit table.
const column = (name: string) => sql`${sql.identifier("survey_file_removals")}.${sql.identifier(name)}`;

/** Shared read predicate; cancellation still locks and revalidates the request. */
export const surveyFileRemovalCanCancel = sql<boolean>`(${column("status")}='queued' OR (${column("status")}='verification_required' AND ${column("progress")}='{}'::jsonb
      AND EXISTS(SELECT 1 FROM audit_events a WHERE a.organisation_id=${column("organisation_id")} AND a.resource_id=${column("id")}::text AND a.action='job.original_removal_preflight_failed' AND a.metadata->>'attemptId'=${column("lease_token")}::text)
      AND NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.organisation_id=${column("organisation_id")} AND a.resource_id=${column("id")}::text AND a.action='job.original_storage_dispatch_recorded')))`;
