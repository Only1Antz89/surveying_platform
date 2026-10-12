import {platformApiContext} from "@/lib/access";
import {ok,problem} from "@/lib/api";
import {checkConnection} from "@/lib/platform-connections";
import {z} from "zod";
export async function POST(_r:Request,{params}:{params:Promise<{id:string}>}){const c=await platformApiContext();if(!c)return problem(401,"unauthorised","Platform access required.");if(c.role!=="super_admin")return problem(403,"forbidden","Platform administrator access required.");const {id}=await params;if(!z.uuid().safeParse(id).success)return problem(422,"invalid_id","Select a connection.");return c.demo?ok({status:"not_configured"}):ok(await checkConnection(id,c.platformStaffId));}
