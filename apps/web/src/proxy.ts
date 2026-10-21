import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import {workspaceRoute} from "@/lib/workspace-mode";
import { embeddingOrigins } from "@/lib/website-form";

const internalPath=/^(\/app\/[^/]+)\/workspace-instances\/([^/]+)(.*)$/;
// Next.js runs the proxy a second time on the path a workspace alias was rewritten
// to, carrying the mode header the first pass set. Keep that mode: resetting it
// would drop every manager/surveyor API call back to the default view, and
// redirecting the internal page path back to its alias would loop forever.
// Honouring the header is safe because manager and surveyor modes only narrow
// access, and the handler still checks the mode against the current membership.
const rewriteModes=["manager","surveyor"];
function rewrittenMode(request:NextRequest){
 const mode=request.headers.get("x-surveynt-workspace-mode");if(!mode||!rewriteModes.includes(mode))return null;
 const path=request.nextUrl.pathname;const internal=path.match(internalPath);
 if(internal)return internal[2]===mode?mode:null;
 return path.startsWith("/api/")&&!workspaceRoute(path).requested?mode:null;
}
function workspaceResponse(request:NextRequest){
 const passthrough=rewrittenMode(request);
 if(passthrough){const headers=new Headers(request.headers);headers.set("x-surveynt-workspace-mode",passthrough);return NextResponse.next({request:{headers}});}
 const route=workspaceRoute(request.nextUrl.pathname);const headers=new Headers(request.headers);
 // Otherwise caller-supplied instance headers are replaced: they never widen authentication or workspace scope.
 headers.set("x-surveynt-workspace-mode",route.requested??"default");
 const target=request.nextUrl.clone();target.pathname=route.requested&&request.nextUrl.pathname.startsWith("/app/")?route.canonical.replace(/^(\/app\/[^/]+)/,`$1/workspace-instances/${route.requested}`):route.canonical;
 return route.requested?NextResponse.rewrite(target,{request:{headers}}):NextResponse.next({request:{headers}});
}
const clerkProxy = clerkMiddleware((_auth,request)=>workspaceResponse(request));

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  const internal=request.nextUrl.pathname.match(internalPath);
  if(internal&&!rewrittenMode(request)){if(!["administration","manager","surveyor"].includes(internal[2]))return new NextResponse(null,{status:404});const publicUrl=request.nextUrl.clone();publicUrl.pathname=internal[1]+(internal[2]==="administration"?"":`/${internal[2]}`)+(internal[3]||"/overview");return NextResponse.redirect(publicUrl);}
  if (request.nextUrl.pathname.startsWith("/app/north-star-surveying")) {
    const destination = request.nextUrl.clone();
    destination.pathname = request.nextUrl.pathname.replace("/app/north-star-surveying", "/app/clifton-surveyors");
    return NextResponse.redirect(destination);
  }
  const response = !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY ? workspaceResponse(request) : await clerkProxy(request, event) ?? workspaceResponse(request);
  if(request.nextUrl.pathname.startsWith("/app/")||request.nextUrl.pathname.startsWith("/api/v1/workspaces/")||request.nextUrl.pathname.startsWith("/portal/")||request.nextUrl.pathname.startsWith("/api/v1/portal/"))response.headers.set("Cache-Control","private, no-store");
  let ancestors = "'none'";
  const embed = request.nextUrl.pathname.match(/^\/embed\/([a-z0-9-]{2,80})\/?$/);
  if (embed) {
    try { const origins = await embeddingOrigins(embed[1]); ancestors = origins.length ? origins.join(" ") : "'none'"; } catch { ancestors = "'none'"; }
    response.headers.set("Cache-Control", "no-store");
  } else if (request.nextUrl.pathname.startsWith("/website-form-preview/")) ancestors = "'self'";
  response.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors}`);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
