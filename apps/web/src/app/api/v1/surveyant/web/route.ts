import {apiContext} from "@/lib/access";
import {ok,problem,parseBody} from "@/lib/api";
import {workspaceApiGuard} from "@/lib/workspace-api-guard";
import {sendWebAnswer,webSearchInput} from "@/lib/surveyant-chat";
import {sendDemoWebAnswer} from "@/lib/survai-demo";
import {canAccessAssignedResource} from "@/lib/workspace-scope";
import {GovernanceError} from "@/lib/ai-governance";

// Runs only a web search the user confirmed from a SurvAI proposal. The signed token
// carries the exact, sanitised query, so nothing else can be searched from here.
export async function POST(r:Request){
 const c=await apiContext(r);if(!c)return problem(401,"unauthorised","Sign in required.");
 const d=await workspaceApiGuard(r,c);if(d)return d;
 if(c.accessLevel!=="full")return problem(403,"read_only","SurvAI web search requires an active workspace.");
 const p=await parseBody(r,webSearchInput);if(!p.success)return problem(422,"invalid_request","Confirm a current search suggestion.");
 if(p.data.jobId&&!c.demo&&!await canAccessAssignedResource(c,"jobs",p.data.jobId))return problem(404,"not_found","Case unavailable.");
 try{return ok(c.demo?await sendDemoWebAnswer({demo:true,mode:"firm",organisationId:c.organisationId,role:c.role},p.data):await sendWebAnswer(c,p.data),c.demo?{demo:true}:{});}
 catch(e){if(e instanceof GovernanceError)return problem(e.status,e.code,e.message);console.error("SurvAI web search failed",{type:e instanceof Error?e.name:"unknown"});return problem(503,"web_search_unavailable","Web search is temporarily unavailable. Retry later.");}
}
