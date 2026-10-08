import {platformApiContext} from "@/lib/access";
import {clientApiContext} from "@/lib/client-api-context";
import {chatInput,supportChat,platformChatHistory} from "@/lib/surveyant-chat";
import {GovernanceError} from "@/lib/ai-governance";
import {ok,problem,parseBody} from "@/lib/api";
import {z} from "zod";
async function context(r:Request,id:string){if(!z.uuid().safeParse(id).success)return null;return clientApiContext(new Request(new URL(`/api/platform/support/${id}/clients`,r.url),{method:"GET"}));}
export async function GET(r:Request,{params}:{params:Promise<{sessionId:string}>}){const id=(await params).sessionId;const [c,p]=await Promise.all([context(r,id),platformApiContext()]);if(!c||!p)return problem(403,"support_expired","An active authorised support session is required.");return ok(c.demo?{messages:[]}:await platformChatHistory(p.platformStaffId,id));}
export async function POST(r:Request,{params}:{params:Promise<{sessionId:string}>}){const id=(await params).sessionId;const [c,p]=await Promise.all([context(r,id),platformApiContext()]);if(!c||!p)return problem(403,"support_expired","An active authorised support session is required.");const input=await parseBody(r,chatInput.omit({jobId:true,conversationId:true}));if(!input.success)return problem(422,"invalid_message","Enter a message.");if(c.demo)return problem(503,"not_configured","Support assistance needs an approved practice AI connection.");try{return ok(await supportChat(p,c,input.data.message,async()=>Boolean(await context(r,id))));}catch(e){return e instanceof GovernanceError?problem(e.status,e.code,e.message):problem(503,"unavailable","Support assistance is unavailable.");}}
