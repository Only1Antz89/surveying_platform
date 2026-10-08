import {workspaceAudit} from "@/lib/workspace-audit";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { auditEvents, createDatabase, websiteEnquiries, withTenant } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { formFailure, formJson } from "@/lib/website-form-api";
export async function GET(request: Request) {
  const c = await apiContext(request); if (!c) return problem(401, "unauthorised", "Sign in to view enquiries.");
  if (!isManagementRole(c.role)) return problem(403, "forbidden", "Practice management access is required.");
  if (c.demo) return ok([]);
  return ok(await withTenant(createDatabase(), c.organisationId, tx => tx.select().from(websiteEnquiries).where(eq(websiteEnquiries.organisationId, c.organisationId)).orderBy(desc(websiteEnquiries.createdAt)).limit(100)));
}
export async function PATCH(request: Request) {
  const c = await apiContext(request); if (!c) return problem(401, "unauthorised", "Sign in to manage enquiries.");
  if (!isManagementRole(c.role) || !canWriteWorkspace(c)) return problem(403, "forbidden", "Writable practice management access is required.");
  if (c.demo) return problem(409, "preview_only", "Local preview cannot update enquiries.");
  try {
    const parsed = z.object({ id: z.uuid(), status: z.enum(["new", "contacted", "closed"]) }).strict().safeParse(await formJson(request)); if (!parsed.success) return problem(400, "invalid_request", "Check the enquiry status.");
    const row = await withTenant(createDatabase(), c.organisationId, async tx => { const [row] = await tx.update(websiteEnquiries).set({ status: parsed.data.status, updatedAt: new Date() }).where(and(eq(websiteEnquiries.organisationId, c.organisationId), eq(websiteEnquiries.id, parsed.data.id))).returning(); if (row) await tx.insert(auditEvents).values(workspaceAudit(c,{ organisationId: c.organisationId, actorUserId: c.internalUserId, action: "website_enquiry.status_changed", resourceType: "website_enquiry", resourceId: row.id, metadata: { status: row.status } })); return row; });
    return row ? ok(row) : problem(404, "not_found", "The enquiry could not be found.");
  } catch (error) { return formFailure(error); }
}
