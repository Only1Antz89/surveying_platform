"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@surveynt/ui";
import {
  Activity, Bell, BookOpenCheck, BriefcaseBusiness, Building2, ChevronDown,
  CircleDollarSign, ClipboardCheck, Database, FileClock, Headphones, House, Menu, Network, Settings,
  ShieldCheck, SlidersHorizontal, Bot, Users, X, CalendarDays, Compass, FileSpreadsheet, BarChart3, FileCheck2, FolderLock, type LucideIcon,
} from "lucide-react";
import { platformRoleLabels, roleLabels, type OrganisationRole, type PlatformRole } from "@surveynt/domain";

type Item = { label: string; href: string; icon: LucideIcon };

const firmItems = (slug: string): Item[] => [
  { label: "Overview", href: `/app/${slug}/overview`, icon: House },
  { label: "Clients", href: `/app/${slug}/clients`, icon: Users },
  { label: "Properties", href: `/app/${slug}/properties`, icon: Building2 },
  { label: "Jobs", href: `/app/${slug}/jobs`, icon: BriefcaseBusiness },
  { label: "Calendar", href: `/app/${slug}/calendar`, icon: CalendarDays },
  { label: "Customers", href: `/app/${slug}/customers`, icon: Users },
  { label: "Routes", href: `/app/${slug}/routes`, icon: Compass },
  { label: "Finance", href: `/app/${slug}/finance`, icon: FileSpreadsheet },
  { label: "Performance", href: `/app/${slug}/performance`, icon: BarChart3 },
  { label: "Report templates", href: `/app/${slug}/report-templates`, icon: FileCheck2 },
  { label: "Documents", href: `/app/${slug}/documents`, icon: FolderLock },
  { label: "Wording", href: `/app/${slug}/wording`, icon: BookOpenCheck },
  { label: "Team", href: `/app/${slug}/team`, icon: ShieldCheck },
  { label: "Settings", href: `/app/${slug}/settings`, icon: Settings },
];

const platformItems: Item[] = [
  { label: "Tenants", href: "/platform/tenants", icon: Building2 },
  { label: "Onboarding", href: "/platform/onboarding", icon: ClipboardCheck },
  { label: "Billing", href: "/platform/billing", icon: CircleDollarSign },
  { label: "Usage", href: "/platform/usage", icon: Activity },
  { label: "Support", href: "/platform/support", icon: Headphones },
  { label: "Incidents", href: "/platform/incidents", icon: ShieldCheck },
  { label: "Practice packs", href: "/platform/practice-packs", icon: BookOpenCheck },
  { label: "Data sources", href: "/platform/data-sources", icon: Database },
  { label: "Assistant", href: "/platform/assistant", icon: Bot },
  { label: "Shared learning", href: "/platform/learning", icon: Network },
  { label: "Audit", href: "/platform/audit", icon: FileClock },
  { label: "Settings", href: "/platform/settings", icon: SlidersHorizontal },
];

type FirmWorkspace = {
  name: string;
  region: string;
  userName: string;
  userRole: OrganisationRole;
  trialEnds: string | null;
};
type PlatformWorkspace = { userName: string; userRole: PlatformRole };

const initials = (value: string) => value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

export function AppShell({ children, mode, slug = "north-star-surveying", workspace, platformWorkspace }: { children: React.ReactNode; mode: "firm" | "platform"; slug?: string; workspace?: FirmWorkspace; platformWorkspace?: PlatformWorkspace }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = mode === "firm" ? firmItems(slug) : platformItems;
  const isDemo = !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  return (
    <div className="app-shell">
      {open ? <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setOpen(false)} /> : null}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-top">
          <BrandMark />
          <button className="mobile-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        <div className="nav-label">{mode === "firm" ? "Workspace" : "Platform operations"}</div>
        <nav className="nav-list" aria-label={mode === "firm" ? "Firm workspace" : "Platform administration"}>
          {items.map((item) => {
            const active = pathname === item.href || (item.href !== "/platform/tenants" && pathname.startsWith(`${item.href}/`));
            return <Link key={item.href} className={`nav-link ${active ? "active" : ""}`} href={item.href} onClick={() => setOpen(false)}><item.icon />{item.label}</Link>;
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="profile-mini">
            <div className="avatar">{mode === "firm" ? initials(workspace?.userName ?? "Practice user") : initials(platformWorkspace?.userName ?? "Platform operator")}</div>
            <div><strong>{mode === "firm" ? workspace?.userName ?? "Practice user" : platformWorkspace?.userName ?? "Platform operator"}</strong><span>{mode === "firm" ? roleLabels[workspace?.userRole ?? "read_only"] : platformRoleLabels[platformWorkspace?.userRole ?? "support"]}</span></div>
            <ChevronDown size={14} color="#8295aa" />
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <button className="menu-button" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu size={18} /></button>
          <div className="workspace-switcher">
            {mode === "firm" ? <div className="avatar">{initials(workspace?.name ?? "Practice")}</div> : <span className="platform-brand-icon"><BrandMark compact variant="primary" /></span>}
            <div>{mode === "firm" ? workspace?.name ?? "Practice workspace" : "Surveynt Platform"}<small>{mode === "firm" ? workspace?.region ?? "United Kingdom" : "Production operations"}</small></div>
          </div>
          <div className="topbar-actions">
            {mode === "firm" && workspace?.trialEnds ? <div className="trial-label"><span>Trial ends</span><b>{workspace.trialEnds}</b></div> : null}
            <button className="icon-button" aria-label="Notifications"><Bell size={16} /></button>
          </div>
        </header>
        {isDemo ? <div className="demo-banner">Demo workspace — connect Clerk, Neon and Stripe to enable production-backed access and billing.</div> : null}
        {children}
      </div>
    </div>
  );
}
