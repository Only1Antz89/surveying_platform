import {z} from "zod";
import {trackingTokenContext,uploadLocation,stopTracking} from "@/lib/tracking";
import {ok,problem,parseBody} from "@/lib/api";
import {GovernanceError} from "@/lib/ai-governance";
const update=z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),accuracyMetres:z.number().nonnegative().max(100000),observedAt:z.iso.datetime()});
async function session(r:Request,id:string){if(!z.uuid().safeParse(id).success)return null;return trackingTokenContext(id,r.headers.get("authorization")?.replace(/^Bearer /,"")??"");}
export async function POST(r:Request,{params}:{params:Promise<{id:string}>}){const c=await session(r,(await params).id);if(!c)return problem(401,"sharing_ended","Location sharing is unavailable or has ended.");const p=await parseBody(r,update);if(!p.success)return problem(422,"invalid_location","Location data invalid.");try{return ok(await uploadLocation(c,p.data));}catch(e){return e instanceof GovernanceError?problem(e.status,e.code,e.message):problem(503,"unavailable","Update not accepted.");}}
export async function DELETE(r:Request,{params}:{params:Promise<{id:string}>}){const c=await session(r,(await params).id);if(!c)return problem(401,"sharing_ended","Location sharing has ended.");await stopTracking(c);return ok({sharing:false});}
