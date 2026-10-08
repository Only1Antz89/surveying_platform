import {mobileContext} from "@/lib/mobile-access";
import {startTracking} from "@/lib/tracking";
import {ok,problem} from "@/lib/api";
import {GovernanceError} from "@/lib/ai-governance";
export async function POST(r:Request){const c=await mobileContext(r);if(!c)return problem(401,"unauthorised","An authorised mobile surveyor session is required.");const body=await r.json().catch(()=>null);if(body?.consent!==true)return problem(422,"consent_required","Explicitly start location sharing.");try{return ok(await startTracking(c));}catch(e){return e instanceof GovernanceError?problem(e.status,e.code,e.message):problem(503,"unavailable","Could not start location sharing.");}}
