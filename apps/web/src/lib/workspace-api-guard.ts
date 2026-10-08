import {jobs as demoJobs,properties as demoProperties} from "./demo-data";
import {demoStore} from "./demo-store";
import {workspaceRoute} from "./workspace-mode";
import { isManagementRole } from "@surveynt/domain";
import { problem } from "./api";
import { canApprove, canRecord, professionalApiGuard, type ProfessionalAccess } from "./professional-access";
import { canAccessAssignedResource, type WorkspaceViewer } from "./workspace-scope";

export async function workspaceApiGuard(request: Request, context: WorkspaceViewer & ProfessionalAccess & { demo?: boolean; accessLevel?: "full" | "billing_only" | "read_only" | "blocked" }) {
  const path = workspaceRoute(new URL(request.url).pathname).canonical.replace(/^\/api\/v1\//, "");
  if (context.accessLevel === "blocked") return problem(403, "workspace_suspended", "Workspace access is suspended. Contact your practice owner or Surveynt support.");
  if (context.accessLevel === "billing_only" && !/^(billing|me|capabilities)(\/|$)/.test(path)) return problem(402, "billing_required", "Complete billing setup before opening workspace records.");
  const management = isManagementRole(context.role);
  if (/^(team|invitations)(\/|$)/.test(path) && !["owner", "administrator"].includes(context.role)) return problem(403, "forbidden", "Only owners and administrators can manage staff access.");
  if (/^(operations|service-catalogue|quotes|insights)(\/|$)/.test(path) && !management) return problem(403, "forbidden", "This area is restricted to practice management.");
  if (/^finance(\/|$)/.test(path) && !management && context.role !== "finance") return problem(403, "forbidden", "Finance access is required.");
  if (context.role === "finance" && !/^(finance|me|capabilities|calendar\/oauth)(\/|$)/.test(path)) return problem(403, "forbidden", "Finance members can access financial records and their personal account only.");
  const professional = professionalApiGuard(request, context);
  if (professional) return professional;
  if (/^jobs\/[^/]+$/.test(path) && request.method === "PATCH") {
    const body = await request.clone().json().catch(() => null);
    if (body?.stage === "issued" && !canApprove(context)) return problem(403, "professional_approval_required", "Report approval / issue permission is required.");
    if (["inspection_complete", "report_drafting", "internal_review"].includes(body?.stage) && !canRecord(context)) return problem(403, "professional_recording_required", "Professional recording permission is required to confirm inspection or survey review stages.");
  }
  if (context.role !== "surveyor") return null;
  if (/^(clients|properties|jobs)$/.test(path) && request.method !== "GET") return problem(403, "forbidden", "Surveyors cannot create practice records or change commercial terms.");
  const match = path.match(/^(jobs|clients|properties|surveys|media)\/([^/]+)/);
  if(match&&context.demo){const own=demoJobs.filter(j=>j.assignee==="Maya Patel");const allowed=match[1]==="jobs"?own.some(j=>j.id===match[2]):match[1]==="properties"?demoProperties.some(p=>p.id===match[2]&&own.some(j=>j.client===p.client)):match[1]==="clients"?(await demoStore.snapshot()).clients.some(c=>c.id===match[2]&&c.organisationId===context.organisationId&&own.some(j=>j.client===c.displayName)):match[1]==="surveys"?own.some(j=>`demo-survey-${j.id}`===match[2]):false;if(!allowed)return problem(404,"record_not_found","The record could not be found in your assigned work.");}
  if (match && !context.demo && !(await canAccessAssignedResource(context, match[1], match[2]))) return problem(404, "record_not_found", "The record could not be found in your assigned work.");
  if (/^(jobs|clients|properties)\/[^/]+$/.test(path) && request.method !== "GET") return problem(403, "forbidden", "Ask practice management to change administrative or commercial records.");
  return null;
}
