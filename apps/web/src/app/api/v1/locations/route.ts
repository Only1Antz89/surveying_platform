import {workspaceAudit} from "@/lib/workspace-audit";
import {and,eq} from "drizzle-orm";
import {z} from "zod";
import {businessLocations,createDatabase,withTenant,auditEvents} from "@surveynt/db";
import {apiContext} from "@/lib/access";
import {ok,problem,parseBody} from "@/lib/api";
import {workspaceApiGuard} from "@/lib/workspace-api-guard";
import {listLocations,locationInput} from "@/lib/staff-operations";
export async function GET(r:Request){const c=await apiContext(r);if(!c)return problem(401,"unauthorised","Sign in required.");const denial=await workspaceApiGuard(r,c);if(denial)return denial;if(!["owner","administrator","manager"].includes(c.role))return problem(403,"forbidden","Management access required.");return ok(await listLocations(c));}
export async function POST(r:Request){return save(r);}
export async function PATCH(r:Request){return save(r);}
async function save(r:Request){const c=await apiContext(r);if(!c)return problem(401,"unauthorised","Sign in required.");if(c.accessLevel!=="full"||!["owner","administrator"].includes(c.role))return problem(403,"forbidden","Owners and administrators manage locations.");const copy=r.clone();const parsed=await parseBody(r,locationInput);if(!parsed.success)return problem(422,"invalid_location","Check name, address and coordinates.");const raw=await copy.json().catch(()=>null);const id=raw?.id as string|undefined;if(r.method==="PATCH"&&!z.uuid().safeParse(id).success)return problem(422,"invalid_id","Select a location.");if(c.demo)return ok(null,{persisted:false});return withTenant(createDatabase(),c.organisationId,async tx=>{const value={...parsed.data,updatedAt:new Date()};let row;if(r.method==="PATCH"){[row]=await tx.update(businessLocations).set({...value,version:(parsed.data.version??0)+1}).where(and(eq(businessLocations.organisationId,c.organisationId),eq(businessLocations.id,id!),eq(businessLocations.version,parsed.data.version??0))).returning();}else [row]=await tx.insert(businessLocations).values({...value,organisationId:c.organisationId}).returning();if(!row)return problem(409,"conflict","The location changed. Reload before saving.");await tx.insert(auditEvents).values(workspaceAudit(c,{organisationId:c.organisationId,actorUserId:c.internalUserId,action:"location.saved",resourceType:"location",resourceId:row.id}));return ok(row);});}
