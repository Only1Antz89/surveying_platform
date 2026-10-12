import {readClientCase} from "@/lib/client-case";
import {ok,problem} from "@/lib/api";
import {z} from "zod";
export async function GET(r:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;if(!z.uuid().safeParse(id).success)return problem(404,"not_found","Case unavailable.");const found=await readClientCase(id,r.headers.get("x-quote-token")??"");return found?ok(found.view):problem(404,"not_found","Case unavailable.");}
