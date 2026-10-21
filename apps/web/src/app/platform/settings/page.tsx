import {ConnectionsPanel} from "@/components/connections-panel";
import { ShieldCheck, SlidersHorizontal } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { PageHeader } from "@/components/page-header";
import { PlatformStaffManager } from "@/components/platform-staff-manager";
import { requirePlatformAccess } from "@/lib/access";
import { loadPlatformStaff } from "@/lib/data";
import { goLiveChecks } from "@/lib/go-live-checks";

export const metadata = { title: "Platform settings" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const [operator, staff] = await Promise.all([requirePlatformAccess(), loadPlatformStaff()]);
  const readiness = [
    { label: "Tenant database", ready: Boolean(process.env.DATABASE_APP_URL), detail: "RLS-restricted application connection", missing: [] as string[], problems: [] as string[], register: [] as { label: string; url: string }[], approvals: [] as string[] },
    { label: "Platform database", ready: Boolean(process.env.DATABASE_ADMIN_URL), detail: "Server-only operational connection", missing: [] as string[], problems: [] as string[], register: [] as { label: string; url: string }[], approvals: [] as string[] },
    ...goLiveChecks().map((check) => ({ ...check, detail: "" })),
  ];
  return <main className="page"><PageHeader eyebrow="Platform operations" title="Platform settings" description="Manage privileged staff access and review production-service readiness." /><div className="stack">{operator.role==="super_admin"?<ConnectionsPanel/>:null}<PlatformStaffManager staff={staff} currentStaffId={operator.platformStaffId} canManage={operator.role === "super_admin"} /><section className="panel"><div className="panel-header"><div><h2>Service readiness</h2><p>Secrets are never displayed; only their configured state is shown.</p></div><ShieldCheck size={17} color="#3b82f6" /></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Service</th><th>Status</th><th>What is needed</th></tr></thead><tbody>{readiness.map((item) => <tr key={item.label}><td><strong>{item.label}</strong></td><td><StatusDot tone={item.ready ? "green" : "amber"}>{item.ready ? "Ready" : "Configuration required"}</StatusDot></td><td>{item.detail ? <p>{item.detail}</p> : null}{item.missing.length ? <p>Missing: <code>{item.missing.join(", ")}</code></p> : null}{item.problems.map((problem) => <p key={problem}>{problem}</p>)}{item.register.map((entry) => <p key={entry.label}>{entry.label}: <code>{entry.url}</code></p>)}{item.approvals.length ? <p>Also needs: {item.approvals.join("; ")}</p> : null}</td></tr>)}</tbody></table></div></section><section className="panel"><div className="panel-header"><div><h2>Trial and access policy</h2><p>Policy changes are deployed through reviewed configuration rather than edited in the production browser.</p></div><SlidersHorizontal size={17} color="#3b82f6" /></div><dl className="detail-grid"><div className="detail"><dt>Trial length</dt><dd>14 calendar days</dd></div><div className="detail"><dt>Payment grace period</dt><dd>7 calendar days</dd></div><div className="detail"><dt>Support session maximum</dt><dd>60 minutes</dd></div><div className="detail"><dt>Break-glass maximum</dt><dd>15 minutes</dd></div><div className="detail"><dt>Payment method</dt><dd>Required before trial access</dd></div><div className="detail"><dt>Professional issue</dt><dd>Named human approval required</dd></div></dl><div className="form-section"><div className="support-banner"><ShieldCheck />These values are read-only in production. Changes require code review, automated checks and a new deployment.</div></div></section></div></main>;
}
