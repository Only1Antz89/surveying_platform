import { and, eq, or, sql } from "drizzle-orm";
import { organisationDocuments } from "@surveynt/db";
import type { OrganisationRole } from "@surveynt/domain";

/** Firm files are shared with practice members; restricted files are admin-only. */
export function documentAccess(role: OrganisationRole, userId: string | null) {
  if (role === "owner" || role === "administrator" || role === "manager") return undefined;
  return or(
    eq(organisationDocuments.accessClass, "firm"),
    and(eq(organisationDocuments.accessClass, "job"), sql`exists (
      select 1 from jobs j where j.id=${organisationDocuments.jobId}
      and j.organisation_id=${organisationDocuments.organisationId}
      and j.assigned_surveyor_id=${userId}
    )`),
  );
}
