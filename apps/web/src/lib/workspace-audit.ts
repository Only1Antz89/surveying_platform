import type {WorkspaceMode} from "./workspace-mode";
/** Attribute the action to the real member; mode describes the interface that initiated it. */
export function workspaceAudit<T extends object>(context:{organisationId:string;actorRole?:string;role?:string;userRole?:string;workspaceMode?:WorkspaceMode},event:T):T & {metadata:Record<string,unknown>} {
 return {...event,metadata:{...(event as {metadata?:Record<string,unknown>|null}).metadata,...(context.workspaceMode?{workspaceMode:context.workspaceMode,actorRole:context.actorRole??context.role??context.userRole}:{})}};
}
