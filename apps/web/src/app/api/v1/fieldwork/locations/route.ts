import {apiContext} from "@/lib/access";
import {latestLocations} from "@/lib/tracking";
import {ok,problem} from "@/lib/api";
export async function GET(r:Request){const c=await apiContext(r);if(!c)return problem(401,"unauthorised","Sign in required.");if(c.accessLevel==="blocked"||c.accessLevel==="billing_only"||!["owner","administrator","manager"].includes(c.role))return problem(403,"forbidden","Management access required.");return ok(c.demo?[]:await latestLocations(c.organisationId));}
