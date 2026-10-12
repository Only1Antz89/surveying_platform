import {assistantUsage} from "@/lib/surveyant-chat";
import {apiContext} from "@/lib/access";
import {ok,problem} from "@/lib/api";
export async function GET(r:Request){const c=await apiContext(r);if(!c)return problem(401,"unauthorised","Sign in required.");if(!["owner","administrator","manager"].includes(c.role)||c.accessLevel==="blocked"||c.accessLevel==="billing_only")return problem(403,"forbidden","Management access required.");if(c.demo)return ok({messagesThisMonth:0});return ok({messagesThisMonth:await assistantUsage(c.organisationId)});}
