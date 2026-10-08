import {platformApiContext} from "@/lib/access";
import {ok,problem,parseBody} from "@/lib/api";
import {chatInput,platformChat,platformChatHistory} from "@/lib/surveyant-chat";
import {GovernanceError} from "@/lib/ai-governance";
export async function POST(r:Request){const c=await platformApiContext();if(!c)return problem(401,"unauthorised","Platform access required.");const p=await parseBody(r,chatInput.omit({jobId:true,conversationId:true}));if(!p.success)return problem(422,"invalid_message","Enter a message.");if(c.demo)return problem(503,"not_configured","No platform assistant connection is configured for this demo.");try{return ok(await platformChat(c,p.data.message));}catch(e){return e instanceof GovernanceError?problem(e.status,e.code,e.message):problem(503,"unavailable","Platform assistance is unavailable.");}}

export async function GET(){const c=await platformApiContext();if(!c)return problem(401,"unauthorised","Platform access required.");return ok(c.demo?{messages:[]}:await platformChatHistory(c.platformStaffId));}
