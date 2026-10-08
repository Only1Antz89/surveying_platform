import type {OrganisationRole} from "@surveynt/domain";
export const workspaceModes=["administration","manager","surveyor"] as const;
export type WorkspaceMode=typeof workspaceModes[number];
export const workspaceLabels:Record<WorkspaceMode,string>={administration:"Practice administration",manager:"Manager workspace",surveyor:"Surveyor workspace"};
export function defaultWorkspaceMode(role:OrganisationRole):WorkspaceMode{return role==="owner"||role==="administrator"?"administration":role==="surveyor"?"surveyor":"manager";}
export function availableWorkspaces(role:OrganisationRole):WorkspaceMode[]{return role==="owner"||role==="administrator"?[...workspaceModes]:role==="manager"?["manager","surveyor"]:role==="surveyor"?["surveyor"]:[];}
export function resolveWorkspace(role:OrganisationRole,requested?:string|null){
 const mode=requested&&requested!=="default"?requested:defaultWorkspaceMode(role);
 if(!workspaceModes.includes(mode as WorkspaceMode)||requested&&requested!=="default"&&!availableWorkspaces(role).includes(mode as WorkspaceMode))return null;
 const effectiveRole:OrganisationRole=availableWorkspaces(role).length?(mode==="surveyor"?"surveyor":mode==="manager"?"manager":role):role;
 return {actorRole:role,workspaceMode:mode as WorkspaceMode,effectiveRole};
}
export function workspaceRoute(path:string):{canonical:string;requested:WorkspaceMode|null}{
 const page=path.match(/^(\/app\/[^/]+)\/(manager|surveyor)(?=\/|$)(.*)$/);
 if(page)return {canonical:page[1]+(page[3]||"/overview"),requested:page[2] as WorkspaceMode};
 const api=path.match(/^\/api\/v1\/workspaces\/(administration|manager|surveyor)(?=\/|$)(.*)$/);
 if(api)return {canonical:(/^\/billing(?:\/|$)/.test(api[2])?"/api":"/api/v1")+api[2],requested:api[1] as WorkspaceMode};
 return {canonical:path,requested:null};
}
export function workspaceHref(href:string,{slug,workspaceMode,actorRole}:{slug:string;workspaceMode:WorkspaceMode;actorRole:OrganisationRole}){
 const base=`/app/${slug}`;if(href!==base&&!href.startsWith(base+"/")&&!href.startsWith(base+"?")&&!href.startsWith(base+"#"))return href;
 const canonical=workspaceRoute(href).canonical;
 const prefix=workspaceMode===defaultWorkspaceMode(actorRole)?"":workspaceMode==="administration"?"":`/${workspaceMode}`;
 return base+prefix+(canonical.slice(base.length)||"/overview");
}
export function rememberedWorkspaceHref(value:string|null,options:Parameters<typeof workspaceHref>[1]){
 const fallback=workspaceHref(`/app/${options.slug}/overview`,options);if(!value||value.length>2000||/[\\\r\n]/.test(value))return fallback;
 const base=`/app/${options.slug}/`;if(!value.startsWith(base)||value.includes("//")||/%(?:2f|5c|2e)/i.test(value)||value.split(/[/?#]/).includes(".."))return fallback;
 const canonical=workspaceRoute(value).canonical;const area=canonical.slice(base.length).split(/[/?#]/)[0];
 const allowed=options.workspaceMode==="surveyor"?["overview","customers","clients","jobs","properties","reports","documents","calendar","routes","account"]:options.workspaceMode==="manager"?["overview","fieldwork","team","staff","customers","clients","jobs","properties","reports","documents","calendar","finance","performance","services","locations","routes","account","settings"]:["overview","fieldwork","team","staff","customers","clients","jobs","properties","reports","documents","calendar","finance","performance","services","locations","routes","account","settings","demo","wording","report-templates"];
 if(allowed&&!allowed.includes(area)||options.workspaceMode==="manager"&&/\/settings\/(billing|website-form)(?:[/?#]|$)/.test(canonical))return fallback;
 return workspaceHref(value,options);
}
export function workspaceApiHref(href:string,mode:WorkspaceMode){
 if(href.startsWith("/api/v1/")&&!href.startsWith("/api/v1/public/")&&!href.startsWith("/api/v1/workspaces/"))return `/api/v1/workspaces/${mode}/${href.slice(8)}`;
 if(href.startsWith("/api/billing/"))return `/api/v1/workspaces/${mode}/${href.slice(5)}`;
 return href;
}
