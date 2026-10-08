import {readClientCase} from "@/lib/client-case";
import {chatInput,chatHistory,sendChat} from "@/lib/surveyant-chat";
import {ok,problem,parseBody} from "@/lib/api";
import {GovernanceError} from "@/lib/ai-governance";
import {z} from "zod";
async function authorised(r:Request,id:string){if(!z.uuid().safeParse(id).success)return null;return readClientCase(id,r.headers.get("x-quote-token")??"");}
export async function GET(r:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const found=await authorised(r,id);if(!found?.quote.row.jobId)return problem(404,"not_found","Case unavailable.");return ok(await chatHistory({organisationId:found.quote.row.organisationId,internalUserId:null,role:"read_only"},{jobId:found.quote.row.jobId,quoteId:id}));}
export async function POST(r:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const found=await authorised(r,id);if(!found?.quote.row.jobId)return problem(404,"not_found","Case unavailable.");const p=await parseBody(r,chatInput.omit({jobId:true,conversationId:true}));if(!p.success)return problem(422,"invalid_message","Enter a message up to 4,000 characters.");try{return ok(await sendChat({organisationId:found.quote.row.organisationId,internalUserId:null,role:"read_only"},p.data,{quoteId:id,token:r.headers.get("x-quote-token")??""}));}catch(e){return e instanceof GovernanceError?problem(e.status,e.code,e.message):problem(503,"unavailable","Surveyant is unavailable. Please contact your practice.");}}
