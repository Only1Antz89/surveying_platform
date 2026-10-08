import {eq} from "drizzle-orm";
import {createDatabase,organisations} from "@surveynt/db";
import {apiContext} from "@/lib/access";
import {ok,problem} from "@/lib/api";
import {demoStore,demoTenant} from "@/lib/demo-store";
import {rememberedWorkspaceHref,workspaceHref,workspaceRoute} from "@/lib/workspace-mode";
import {canAccessAssignedResource} from "@/lib/workspace-scope";
import {workspaceApiGuard} from "@/lib/workspace-api-guard";
/** Validate remembered destinations against today's membership and assignments before changing views. */
export async function GET(request:Request){
 const context=await apiContext(request);if(!context)return problem(403,"workspace_unavailable","Your account no longer has access to this workspace.");
 const candidate=new URL(request.url).searchParams.get("href");const requestedSlug=candidate?.match(/^\/app\/([^/]+)/)?.[1];
 if(!requestedSlug)return problem(422,"invalid_destination","Choose a practice page.");
 let slug:string;
 if(context.demo){const tenant=demoTenant(await demoStore.snapshot(),requestedSlug);if(!tenant||tenant.id!==context.organisationId)return problem(404,"not_found","Practice unavailable.");slug=requestedSlug;}
 else {const [tenant]=await createDatabase().select({slug:organisations.slug}).from(organisations).where(eq(organisations.id,context.organisationId)).limit(1);if(!tenant)return problem(404,"not_found","Practice unavailable.");slug=tenant.slug;}
 const options={slug,actorRole:context.actorRole,workspaceMode:context.workspaceMode};let href=rememberedWorkspaceHref(candidate,options);
 const path=workspaceRoute(href.split(/[?#]/)[0]).canonical;const resource=path.match(/^\/app\/[^/]+\/(jobs|properties|clients)\/([^/]+)/);
 if(resource&&context.role==="surveyor"){
  const denial=context.demo?await workspaceApiGuard(new Request(`https://internal.invalid/api/v1/${resource[1]}/${resource[2]}`),context):!await canAccessAssignedResource(context,resource[1],resource[2]);
  if(denial)href=workspaceHref(`/app/${slug}/overview`,options);
 }
 return ok({href});
}
