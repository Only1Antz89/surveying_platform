import {apiContext} from "@/lib/access";
import {ok,problem} from "@/lib/api";
import {workspaceApiGuard} from "@/lib/workspace-api-guard";
import {tenantConnectionStatuses} from "@/lib/platform-connections";
export async function GET(r:Request){const c=await apiContext(r);if(!c)return problem(401,"unauthorised","Sign in required.");const d=await workspaceApiGuard(r,c);if(d)return d;if(!["owner","administrator","manager"].includes(c.role))return problem(403,"forbidden","Management access required.");const rows=c.demo?[]:await tenantConnectionStatuses(c.organisationId);return ok(rows.map(row=>({name:row.name,kind:row.kind,enabled:row.enabled&&row.tenantEnabled,status:row.checkStatus,checkedAt:row.lastCheckedAt,evaluationOnly:row.evaluationOnly})));}
