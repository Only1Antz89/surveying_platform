"use client";
import {createContext,useContext,useEffect,useSyncExternalStore} from "react";
import {usePathname,useSearchParams} from "next/navigation";
import {type OrganisationRole} from "@surveynt/domain";
import {defaultWorkspaceMode,workspaceRoute,type WorkspaceMode} from "@/lib/workspace-mode";
import {pendingWorkspaceSaves,subscribeWorkspaceSaves} from "@/lib/workspace-request";
type WorkspaceContext={slug:string;userId:string;organisationId:string;actorRole:OrganisationRole;workspaceMode:WorkspaceMode};
const Context=createContext<WorkspaceContext|null>(null);
export function WorkspaceProvider({children,...identity}:Omit<WorkspaceContext,"workspaceMode">&{children:React.ReactNode}){
 const pathname=usePathname(),query=useSearchParams();const workspaceMode=workspaceRoute(pathname).requested??defaultWorkspaceMode(identity.actorRole);
 useEffect(()=>{const href=pathname+(query.size?`?${query}`:"");try{sessionStorage.setItem(`surveynt:instance:${identity.userId}:${identity.organisationId}:${workspaceMode}`,href);}catch{/* Switching still works when browser storage is unavailable. */}},[pathname,query,identity.userId,identity.organisationId,workspaceMode]);
 return <Context.Provider value={{...identity,workspaceMode}}>{children}</Context.Provider>;
}
export const useWorkspace=()=>useContext(Context);
export const usePendingWorkspaceSaves=()=>useSyncExternalStore(subscribeWorkspaceSaves,pendingWorkspaceSaves,()=>0);
