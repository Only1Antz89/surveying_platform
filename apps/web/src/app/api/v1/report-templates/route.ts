import { and, eq } from "drizzle-orm";
import { auditEvents, createDatabase, onboardingSteps, organisationMemberships, organisationOperationalSettings, withTenant } from "@surveynt/db";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { ok, problem } from "@/lib/api";
import { reportTemplateSettingsSchema } from "@/lib/report-template-settings";
export async function GET(request:Request) {
  const context=await apiContext(request);if(!context)return problem(401,"unauthorised","Sign in to your company.");
  const denial=await workspaceApiGuard(request,context);if(denial)return denial;
  if(context.demo)return ok({templates:[]},{demo:true,persisted:false});
  const [row]=await withTenant(createDatabase(),context.organisationId,tx=>tx.select({settings:organisationOperationalSettings.reportTemplateSettings}).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,context.organisationId)).limit(1));
  return ok(row?.settings ?? {templates:[]});
}
export async function PATCH(request:Request) {
  const context=await apiContext(request);if(!context)return problem(401,"unauthorised","Sign in to your company.");
  const denial=await workspaceApiGuard(request,context);if(denial)return denial;
  if(!["owner","administrator"].includes(context.role)||!canWriteWorkspace(context))return problem(403,"forbidden","Only company owners and administrators can configure licensed templates.");
  const parsed=reportTemplateSettingsSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return problem(400,"invalid_request","Check template licences and service mappings.",parsed.error.flatten());
  if(context.demo)return ok(parsed.data,{demo:true,persisted:false});
  const saved=await withTenant(createDatabase(),context.organisationId,async tx=>{
    const [member]=await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId,context.organisationId),eq(organisationMemberships.userId,context.internalUserId!),eq(organisationMemberships.active,true))).for("share").limit(1);
    if(!member||member.role!==context.role)return false;
    await tx.insert(organisationOperationalSettings).values({organisationId:context.organisationId,reportTemplateSettings:parsed.data}).onConflictDoUpdate({target:organisationOperationalSettings.organisationId,set:{reportTemplateSettings:parsed.data,updatedAt:new Date()}});
    await tx.insert(onboardingSteps).values({organisationId:context.organisationId,key:"report_templates",completedAt:new Date(),completedByUserId:context.internalUserId}).onConflictDoUpdate({target:[onboardingSteps.organisationId,onboardingSteps.key],set:{completedAt:new Date(),completedByUserId:context.internalUserId}});
    await tx.insert(auditEvents).values({organisationId:context.organisationId,actorUserId:context.internalUserId,action:"firm.report_templates_configured",resourceType:"organisation",resourceId:context.organisationId,metadata:{templates:parsed.data.templates.map(row=>`${row.templateKey}@${row.templateVersion}`)}});return true;
  });
  return saved?ok(parsed.data):problem(403,"forbidden","Your settings permission changed.");
}
