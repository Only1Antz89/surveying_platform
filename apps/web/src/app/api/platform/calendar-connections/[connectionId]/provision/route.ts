import {z} from "zod";
import {createDatabase} from "@surveynt/db";
import {platformApiContext} from "@/lib/access";
import {ok,parseBody,problem} from "@/lib/api";
import {missingChannelReviewSchema,queueReviewedMissingChannel} from "@/lib/calendar-missing-channel";
export const runtime="nodejs";
export async function POST(request:Request,route:RouteContext<"/api/platform/calendar-connections/[connectionId]/provision">){
 const operator=await platformApiContext();if(!operator)return problem(401,"unauthorised","Platform staff authentication is required.");
 if(!["support","super_admin"].includes(operator.role))return problem(403,"forbidden","Your role cannot review calendar provisioning.");
 const {connectionId}=await route.params;if(!z.uuid().safeParse(connectionId).success)return problem(404,"not_found","Calendar connection not found.");
 const input=await parseBody(request,missingChannelReviewSchema);if(!input.success)return problem(400,"invalid_request","Verify the current account and provider absence evidence.");
 if(operator.demo)return ok({id:connectionId},{demo:true,persisted:false});
 try{return ok(await queueReviewedMissingChannel(createDatabase(process.env.DATABASE_ADMIN_URL),connectionId,operator.platformStaffId,input.data),{reviewed:true});}
 catch{return problem(409,"review_required","Reload this connection, resolve existing subscription work, and verify credentials, configuration and exact provider absence before retrying.");}
}
