import { z } from "zod";
import { eq } from "drizzle-orm";
import { auditEvents, createDatabase, organisationOperationalSettings, withTenant } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { ok, parseBody, problem } from "@/lib/api";
import { emailTemplatesSchema } from "@/lib/email-template-settings";

const input = z.object({expected:emailTemplatesSchema, templates:emailTemplatesSchema, confirmed:z.literal(true)}).strict();
export async function PATCH(request:Request) {
  const context = await apiContext(request);
  if (!context) return problem(401,"unauthorised","Sign in to edit email templates.");
  const denial = await workspaceApiGuard(request,context); if (denial) return denial;
  if (!canWriteWorkspace(context) || !isManagementRole(context.role)) return problem(403,"forbidden","Practice management access is required.");
  const parsed = await parseBody(request,input);
  if (!parsed.success) return problem(400,"invalid_request","Review the template variables and confirm the changes.",parsed.error.flatten());
  if (context.demo) return ok(parsed.data.templates,{demo:true,persisted:false});
  return withTenant(createDatabase(),context.organisationId,async tx => {
    await tx.insert(organisationOperationalSettings).values({organisationId:context.organisationId}).onConflictDoNothing();
    const [current] = await tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,context.organisationId)).for("update");
    // Canonical schema order makes the review independent of JSON key ordering.
    if (JSON.stringify(emailTemplatesSchema.parse(current.emailTemplates)) !== JSON.stringify(parsed.data.expected)) return problem(409,"template_changed","The saved template changed. Reload and review it again.");
    await tx.update(organisationOperationalSettings).set({emailTemplates:parsed.data.templates,updatedAt:new Date()}).where(eq(organisationOperationalSettings.organisationId,context.organisationId));
    await tx.insert(auditEvents).values({organisationId:context.organisationId,actorUserId:context.internalUserId,action:"notification.templates_updated",resourceType:"organisation",resourceId:context.organisationId,metadata:{previous:current.emailTemplates,next:parsed.data.templates,confirmed:true}});
    return ok(parsed.data.templates);
  });
}
