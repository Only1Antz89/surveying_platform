import { GET as workspaceTools } from "@/app/api/v1/workspace-tools/route";
/** Reuses permission-filtered operational events; /me allows personal finance alerts. */
export async function GET(request:Request){
  const url=new URL(request.url);url.searchParams.set("kind","notifications");
  return workspaceTools(new Request(url,request));
}
