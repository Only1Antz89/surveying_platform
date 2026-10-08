"use client";
import {WorkspaceAnchor} from "@/components/workspace-anchor";

import {workspaceFetch,createWorkspaceReadScope} from "@/lib/workspace-request";
import {useWorkspace} from "./workspace-provider";
import {WorkspaceInstanceSwitch} from "./workspace-instance-switch";
import {resolveWorkspace,workspaceRoute,workspaceLabels,type WorkspaceMode} from "@/lib/workspace-mode";
import {SurveyantOverlay} from "./surveyant-overlay";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "@/components/workspace-link";
import Image from "next/image";
import { usePathname,useSearchParams } from "next/navigation";
import { BrandMark } from "@surveynt/ui";
import { Bell, BriefcaseBusiness, CalendarDays, ChartNoAxesCombined, ChevronDown, CirclePoundSterling, House, Menu, Search, Settings, MapPin, ScanLine, UserRound, Wrench, Users, X, type LucideIcon } from "lucide-react";
import { platformRoleLabels, roleLabels, type OrganisationRole, type PlatformRole } from "@surveynt/domain";
import { ThemeCycleButton } from "./theme-cycle-button";
import { DeviceNotificationListener } from "./device-notifications";
import { LegacyAppShell } from "./legacy-app-shell";
import { AccountMenu } from "./account-menu";

type Item = { label: string; href: string; icon: LucideIcon; paths?: string[] };
const firmItems = (slug: string): Item[] => [
  { label: "Overview", href: `/app/${slug}/overview`, icon: House },
  { label: "Daily fieldwork", href: `/app/${slug}/fieldwork`, icon: ScanLine },
  { label: "Surveyors & staff", href: `/app/${slug}/team`, icon: UserRound, paths: ["team", "staff"] },
  { label: "CRM suite", href: `/app/${slug}/customers`, icon: Users, paths: ["customers", "clients"] },
  { label: "Jobs", href: `/app/${slug}/jobs`, icon: BriefcaseBusiness, paths: ["jobs", "properties", "reports", "documents", "wording", "report-templates", "surveys"] },
  { label: "Calendar", href: `/app/${slug}/calendar`, icon: CalendarDays },
  { label: "Finance", href: `/app/${slug}/finance`, icon: CirclePoundSterling },
  { label: "Reports & insights", href: `/app/${slug}/performance`, icon: ChartNoAxesCombined },
  { label: "Services", href: `/app/${slug}/services`, icon: Wrench },
  { label: "Locations & routing", href: `/app/${slug}/locations`, icon: MapPin, paths: ["locations", "routes"] },
];
const platformItems: Item[] = [
  { label: "Practices", href: "/platform/tenants", icon: Users, paths: ["tenants", "onboarding"] },
  { label: "Billing & usage", href: "/platform/billing", icon: CirclePoundSterling, paths: ["billing", "usage"] },
  { label: "Support", href: "/platform/support", icon: House, paths: ["support", "incidents"] },
  { label: "Standards & intelligence", href: "/platform/data-sources", icon: BriefcaseBusiness, paths: ["data-sources", "practice-packs", "assistant", "learning"] },
  { label: "Audit", href: "/platform/audit", icon: ChartNoAxesCombined },
];
type Workspace = { name: string; region: string; userName: string; userRole: OrganisationRole; actorRole?:OrganisationRole; workspaceMode?:WorkspaceMode; trialEnds: string | null; demo?: boolean; logoUrl?: string | null };
const initials = (value: string) => value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
export function AppShell({ children, mode, slug = "clifton-surveyors", workspace, platformWorkspace,polishEnabled=true }: { children: React.ReactNode; mode: "firm" | "platform"; slug?: string; workspace?: Workspace; platformWorkspace?: { userName: string; userRole: PlatformRole };polishEnabled?:boolean }) {
  const instance=useWorkspace();const pathname=workspaceRoute(usePathname()).canonical;
  const role=instance?resolveWorkspace(instance.actorRole,instance.workspaceMode)?.effectiveRole??workspace?.userRole??"read_only":workspace?.userRole??"read_only";
  const [open, setOpen] = useState(false); const [tool, setTool] = useState<"search" | "notifications" | null>(null); const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; label: string; href: string; detail: string }[]>([]); const [loadError, setLoadError] = useState("");
  const [searched,setSearched]=useState(false);
  const searchRequests=useRef(createWorkspaceReadScope()); const dialog = useRef<HTMLDialogElement>(null); const menuButton = useRef<HTMLButtonElement>(null); const sidebar = useRef<HTMLElement>(null);
  const items = mode === "firm" ? firmItems(slug).filter(item=>instance?.workspaceMode!=="administration"||["Overview","Surveyors & staff","Services","Locations & routing"].includes(item.label)).filter(item=>role === "finance" ? item.label === "Finance" : !["Finance","Reports & insights"].includes(item.label)||(item.label === "Finance" ? ["owner","administrator","manager","finance"] : ["owner","administrator","manager"]).includes(role??"read_only")).filter(item => !["Daily fieldwork", "Surveyors & staff", "Services", "Locations & routing"].includes(item.label) || ["owner", "administrator", "manager"].includes(role ?? "")) : platformItems; if(mode==="firm"&&role==="surveyor")items.push({label:"Route planning",href:`/app/${slug}/routes`,icon:MapPin}); const base = `/app/${slug}`;
  const selected = items.find((item) => item.paths?.some((part) => pathname.startsWith(`${mode === "firm" ? base : "/platform"}/${part}`)) || pathname.startsWith(item.href));
  let subitems = mode === "firm" ? selected?.label === "Jobs" ? [["Jobs", "jobs"], ["Properties", "properties"], ["Reports", "reports"], ["Documents", "documents"]] : selected?.label === "CRM suite" ? (role === "surveyor" ? [["Customer register", "customers"]] : [["Customer register", "customers"], ["Quotes", "customers?view=quotes"]]) : selected?.label === "Calendar" ? [["Calendar", "calendar"], ["Availability", "calendar?view=availability"]] : pathname.includes("/settings") || pathname.includes("/team") ? [["Practice", "settings"], ["Operations & connections", "settings/operations"], ["Team", "team"], ["Billing", "settings/billing"], ["Assistant", "settings/ai"], ["Shared learning", "settings/learning"]] : [] : selected?.label === "Practices" ? [["Practices", "tenants"], ["Onboarding", "onboarding"]] : selected?.label === "Billing & usage" ? [["Billing", "billing"], ["Usage", "usage"]] : selected?.label === "Support" ? [["Support", "support"], ["Incidents", "incidents"]] : selected?.label === "Standards & intelligence" ? [["Data sources", "data-sources"], ["Practice packs", "practice-packs"], ["Assistant", "assistant"], ["Shared learning", "learning"]] : [];
  if (mode === "firm") subitems = subitems.filter(([,path]) => path !== "team" || ["owner","administrator"].includes(role ?? "")).filter(([,path]) => path !== "settings/billing" || role === "owner");
  if (mode === "firm" && ["owner", "administrator"].includes(role ?? "") && pathname.includes("/settings")) subitems.splice(2, 0, ["Website form", "settings/website-form"]);
  if (mode === "firm" && selected?.label === "CRM suite" && ["owner", "administrator", "manager"].includes(role ?? "")) subitems.push(["Website enquiries", "customers?view=enquiries"]);
  useEffect(() => { if (!open) return; const previous = document.activeElement as HTMLElement; const node = sidebar.current; const bodyOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; node?.querySelector<HTMLButtonElement>("button")?.focus(); function trap(event: KeyboardEvent) { if (event.key === "Escape") { setOpen(false); menuButton.current?.focus(); } if (event.key !== "Tab" || !node) return; const focusable = [...node.querySelectorAll<HTMLElement>("a,button:not(:disabled),select:not(:disabled),input:not(:disabled),textarea:not(:disabled)")]; const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } document.addEventListener("keydown", trap); return () => { document.body.style.overflow = bodyOverflow; document.removeEventListener("keydown", trap); previous?.focus(); }; }, [open]);
  useEffect(()=>{const reader=searchRequests.current;reader.cancel();dialog.current?.close();const timer=setTimeout(()=>{setResults([]);setLoadError("");setQuery("");setSearched(false);},0);return()=>{clearTimeout(timer);reader.cancel();};},[instance?.workspaceMode]);
  async function show(next: "search" | "notifications") { setTool(next); setLoadError(""); setResults([]); setSearched(false); dialog.current?.showModal(); if (next === "notifications") await find("", next); }
  async function find(term: string, kind = tool) { const read=searchRequests.current.start();setLoadError(""); try { const response = await workspaceFetch(`/api/v1/workspace-tools?kind=${kind}&q=${encodeURIComponent(term)}`, { cache: "no-store",signal:read.signal }); const payload = await response.json(); if(!read.isCurrent())return; if (!response.ok) throw new Error(payload.error?.message ?? "Could not load results."); setResults(payload.data); setSearched(true); } catch (error) { if(read.isCurrent())setLoadError((error as Error).message); } }
  const account = mode === "firm" ? `${base}/account` : "/account";
  if(!polishEnabled)return <LegacyAppShell mode={mode} slug={slug} workspace={workspace} platformWorkspace={platformWorkspace}>{children}</LegacyAppShell>;
  return <div className="app-shell new-ui">{mode==="firm"?<DeviceNotificationListener key={instance?.workspaceMode} slug={slug}/>:null}<WorkspaceAnchor className="skip-link" href="#workspace-content">Skip to content</WorkspaceAnchor>
    {open ? <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setOpen(false)} /> : null}
    <aside ref={sidebar} className={`sidebar ${open ? "open" : ""}`} aria-label="Navigation"><div className="sidebar-top">{mode === "platform" ? <BrandMark /> : <Link href={`${base}/overview`} className="practice-brand">{workspace?.logoUrl?.startsWith("https://")?<Image src={workspace.logoUrl} alt="Practice logo" width={35} height={35} unoptimized/>:<span className="brand-building"><House size={21}/></span>}<span><strong>{workspace?.name}</strong><small>SURVEY WORKSPACE</small></span></Link>}<button className="mobile-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={20} /></button></div>
      <div className="practice-label"><strong>{workspace?.name ?? "Surveynt Platform"}</strong><span>{workspace?.demo ? "Demo workspace" : workspace?.region ?? "Operator workspace"}</span></div>
      {mode==="firm"?<WorkspaceInstanceSwitch/>:null}
      <nav className="nav-list" aria-label={mode === "firm" ? "Practice" : "Platform"}>{items.map((item) => <Link key={item.href} href={item.href} aria-current={selected === item ? "page" : undefined} className={`nav-link ${selected === item ? "active" : ""}`} onClick={() => setOpen(false)}><item.icon />{item.label}</Link>)}</nav>
      <div className="sidebar-footer"><ThemeCycleButton/>{mode === "platform" || ["owner","administrator","manager"].includes(role ?? "") ? <Link className="nav-link" href={mode === "firm" ? `${base}/settings` : "/platform/settings"} onClick={() => setOpen(false)}><Settings size={18} />Settings</Link> : null}<Link className="profile-mini" href={account} onClick={() => setOpen(false)}><div className="avatar">{initials(workspace?.userName ?? platformWorkspace?.userName ?? "User")}</div><div><strong>{workspace?.userName ?? platformWorkspace?.userName ?? "Your account"}</strong><span>{mode === "firm" ? roleLabels[instance?.actorRole??workspace?.actorRole??role] : platformRoleLabels[platformWorkspace?.userRole ?? "support"]}</span></div><ChevronDown size={16} /></Link></div>
    </aside>
    <div className="app-main"><header className="topbar"><button ref={menuButton} className="menu-button" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={20} /></button><div className="workspace-switcher"><span className="breadcrumb-icon"><House size={18} /></span><span>{instance?workspaceLabels[instance.workspaceMode]:"Surveynt platform"}<small className="instance-page-label">{selected?.label ?? (pathname.includes("account") ? "Your account" : "Settings")}</small></span></div><div className="topbar-actions">{mode === "firm" ? <button className="workspace-search" aria-label="Search your practice" onClick={() => void show("search")}><Search size={17} /><span>Search jobs, customers, properties…</span></button> : null}{mode === "firm" ? <button className="icon-button" aria-label="Notifications" onClick={() => void show("notifications")}><Bell size={18} /></button> : null}<AccountMenu href={account} name={workspace?.userName ?? platformWorkspace?.userName ?? "User"} /></div></header>
      {workspace?.demo ? <div className="demo-banner">Demo practice · fictional customers and simulated integrations {["owner","administrator","manager"].includes(role)?<Link href={`${base}/demo`}>Open stakeholder guide</Link>:null}</div> : null}
      {subitems.length ? <Suspense fallback={<nav className="context-nav" aria-label="Section navigation">{subitems.map(([label,path])=><Link key={path} href={`${mode==="firm"?base:"/platform"}/${path}`}>{label}</Link>)}</nav>}><SectionNavigation items={subitems} base={mode==="firm"?base:"/platform"} pathname={pathname}/></Suspense> : null}
      <div key={`${instance?.userId}:${instance?.organisationId}:${instance?.workspaceMode}`} id="workspace-content" tabIndex={-1}>{children}</div>
    </div>
    <SurveyantOverlay mode={mode} slug={mode==="firm"?slug:undefined} name={workspace?.name??"Surveynt"}/>
    <dialog className="workspace-dialog" ref={dialog} onClose={() => setTool(null)}><div className="panel-header"><h2>{tool === "search" ? "Find in your practice" : "Recent notifications"}</h2><button className="icon-button" aria-label="Close" onClick={() => dialog.current?.close()}><X size={18} /></button></div><div className="panel-body">{tool === "search" ? <form className="tool-search" onSubmit={(event) => { event.preventDefault(); void find(query); }}><input className="input" autoFocus value={query} minLength={2} maxLength={100} placeholder="Search by name, address or reference" aria-label="Search your practice" onChange={(event) => setQuery(event.target.value)} /><button className="button button-primary">Search</button></form> : null}{loadError ? <p role="alert" className="form-error">{loadError}</p> : null}<ul className="search-results">{results.map((result) => <li key={result.id}><Link href={result.href.replace("{slug}", slug)} onClick={() => dialog.current?.close()}><strong>{result.label}</strong><span>{result.detail}</span></Link></li>)}</ul>{!results.length && !loadError ? <p className="muted">{tool === "search" ? searched ? "No matching records found." : "Submit a search to find records." : "No recent notifications."}</p> : null}</div></dialog>
  </div>;
}
function SectionNavigation({items,base,pathname}:{items:string[][];base:string;pathname:string}){
  const query=useSearchParams();
  return <nav className="context-nav" aria-label="Section navigation">{items.map(([label,path])=>{const active=pathname===`${base}/${path.split("?")[0]}`&&(path.includes("?")?query.get("view")===path.split("=")[1]:!query.get("view"));return <Link key={path} className={active?"active":""} aria-current={active?"page":undefined} href={`${base}/${path}`}>{label}</Link>;})}</nav>;
}
