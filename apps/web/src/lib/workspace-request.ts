import {workspaceRoute} from "./workspace-mode";
let pending=0;const listeners=new Set<()=>void>();
export const subscribeWorkspaceSaves=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const pendingWorkspaceSaves=()=>pending;
const notify=()=>listeners.forEach(listener=>listener());
/** Explicit browser request adapter; never replaces global fetch or carries mode to another origin. */
export async function workspaceFetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response>{
 if(typeof window==="undefined")return fetch(input,init);
 const original=input instanceof Request?input.url:String(input);const url=new URL(original,window.location.href);
 const protectedApi=url.origin===window.location.origin&&(url.pathname.startsWith("/api/v1/")&&!url.pathname.startsWith("/api/v1/public/")||url.pathname.startsWith("/api/billing/"));
 const requested=workspaceRoute(window.location.pathname).requested;
 if(protectedApi&&requested&&!url.pathname.startsWith("/api/v1/workspaces/"))url.pathname=`/api/v1/workspaces/${requested}/${url.pathname.startsWith("/api/billing/")?url.pathname.slice("/api/".length):url.pathname.slice("/api/v1/".length)}`;
 const method=(init?.method??(input instanceof Request?input.method:"GET")).toUpperCase();const mutation=protectedApi&&!["GET","HEAD","OPTIONS"].includes(method);
 if(mutation){pending++;notify();}
 try{return await fetch(input instanceof Request?new Request(url,input):url,init);}finally{if(mutation){pending--;notify();}}
}

/** Cancel previous reads and make late fulfilled responses harmless, even if a provider ignores abort. */
export function createWorkspaceReadScope(){let revision=0,controller:AbortController|null=null;return {
 cancel(){revision++;controller?.abort();controller=null;},
 start(){controller?.abort();controller=new AbortController();const current=++revision,signal=controller.signal;return {signal,isCurrent:()=>current===revision&&!signal.aborted};},
};}
