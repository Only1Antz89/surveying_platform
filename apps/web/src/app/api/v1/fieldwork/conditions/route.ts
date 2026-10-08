import {and,eq} from "drizzle-orm";
import {createDatabase,withTenant,businessLocations} from "@surveynt/db";
import {apiContext} from "@/lib/access";
import {ok,problem} from "@/lib/api";
import {fieldworkConditions} from "@/lib/fieldwork-conditions";
export async function GET(r:Request){const c=await apiContext(r);if(!c)return problem(401,"unauthorised","Sign in required.");if(c.accessLevel==="blocked"||c.accessLevel==="billing_only"||!["owner","administrator","manager"].includes(c.role))return problem(403,"forbidden","Management access required.");if(c.demo)return ok({weather:{status:"not_configured"},traffic:{status:"not_configured",coverage:"TfL London road network only",etaAdjusted:false}});const [base]=await withTenant(createDatabase(),c.organisationId,tx=>tx.select().from(businessLocations).where(and(eq(businessLocations.organisationId,c.organisationId),eq(businessLocations.active,true))).limit(1));return ok(await fieldworkConditions(c.organisationId,base?.latitude!=null&&base.longitude!=null?{latitude:base.latitude,longitude:base.longitude}:null));}
