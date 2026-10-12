import {survaiContextError} from "@/lib/survai-context";
import {platformApiContext} from "@/lib/access";
import {ok,problem,parseBody} from "@/lib/api";
import {chatInput,platformChat,platformChatHistory} from "@/lib/surveyant-chat";
import {GovernanceError} from "@/lib/ai-governance";
import {sendDemoSurvai} from "@/lib/survai-demo";
export async function POST(r:Request){const c=await platformApiContext();if(!c)return problem(401,"unauthorised","Platform access required.");const p=await parseBody(r,chatInput.omit({jobId:true,conversationId:true}));if(!p.success)return problem(422,"invalid_message","Enter a message.");const contextError=survaiContextError(p.data.pageContext,{mode:"platform",platformRole:c.role});if(contextError)return problem(contextError.status,"page_context_forbidden",contextError.message);try{return ok(c.demo?await sendDemoSurvai({demo:true,mode:"platform",platformRole:c.role},p.data):await platformChat(c,p.data.message,p.data.pageContext),c.demo?{demo:true}:{});}catch(e){return e instanceof GovernanceError?problem(e.status,e.code,e.message):problem(503,"unavailable","Platform assistance is unavailable.");}}

export async function GET(){const c=await platformApiContext();if(!c)return problem(401,"unauthorised","Platform access required.");return ok(c.demo?{messages:[]}:await platformChatHistory(c.platformStaffId));}
