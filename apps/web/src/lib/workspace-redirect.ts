import {redirect} from "next/navigation";
import {requireFirmAccess} from "./access";
import {workspaceHref} from "./workspace-mode";
export async function redirectWorkspace(href:string){const slug=href.match(/^\/app\/([^/]+)/)?.[1];if(!slug)redirect(href);const access=await requireFirmAccess(slug);redirect(workspaceHref(href,{slug,workspaceMode:access.workspaceMode,actorRole:access.actorRole}));}
