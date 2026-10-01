import { ShieldCheck, SlidersHorizontal } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { PageHeader } from "@/components/page-header";
import { PlatformStaffManager } from "@/components/platform-staff-manager";
import { requirePlatformAccess } from "@/lib/access";
import { loadPlatformStaff } from "@/lib/data";

export const metadata = { title: "Platform settings" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const [operator, staff] = await Promise.all([requirePlatformAccess(), loadPlatformStaff()]);
  const readiness = [
    { label: "Authentication", ready: Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY), detail: "Clerk account and organisation access" },
    { label: "Tenant database", ready: Boolean(process.env.DATABASE_APP_URL), detail: "RLS-restricted application connection" },
    { label: "Platform database", ready: Boolean(process.env.DATABASE_ADMIN_URL), detail: "Server-only operational connection" },
    { label: "Stripe billing", ready: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_BASE_PRICE_ID), detail: "Checkout, subscriptions and webhooks" },
    { label: "SMTP2GO email", ready: Boolean(process.env.SMTP2GO_API_KEY && process.env.SMTP2GO_SENDER), detail: "Transactional delivery and trial notices" },
    { label: "Daily scheduler", ready: Boolean(process.env.CRON_SECRET), detail: "Protected 08:00 UTC lifecycle run" },
  ];
  return <main className="page"><PageHeader eyebrow="Platform operations" title="Platform settings" description="Manage privileged staff access and review production-service readiness." /><div className="stack"><PlatformStaffManager staff={staff} currentStaffId={operator.platformStaffId} canManage={operator.role === "super_admin"} /><section className="panel"><div className="panel-header"><div><h2>Service readiness</h2><p>Secrets are never displayed; only their configured state is shown.</p></div><ShieldCheck size={17} color="#3b82f6" /></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Service</th><th>Status</th><th>Purpose</th></tr></thead><tbody>{readiness.map((item) => <tr key={item.label}><td><strong>{item.label}</strong></td><td><StatusDot tone={item.ready ? "green" : "amber"}>{item.ready ? "Ready" : "Configuration required"}</StatusDot></td><td>{item.detail}</td></tr>)}</tbody></table></div></section><section className="panel"><div className="panel-header"><div><h2>Trial and access policy</h2><p>Policy changes are deployed through reviewed configuration rather than edited in the production browser.</p></div><SlidersHorizontal size={17} color="#3b82f6" /></div><dl className="detail-grid"><div className="detail"><dt>Trial length</dt><dd>14 calendar days</dd></div><div className="detail"><dt>Payment grace period</dt><dd>7 calendar days</dd></div><div className="detail"><dt>Support session maximum</dt><dd>60 minutes</dd></div><div className="detail"><dt>Break-glass maximum</dt><dd>15 minutes</dd></div><div className="detail"><dt>Payment method</dt><dd>Required before trial access</dd></div><div className="detail"><dt>Professional issue</dt><dd>Named human approval required</dd></div></dl><div className="form-section"><div className="support-banner"><ShieldCheck />These values are read-only in production. Changes require code review, automated checks and a new deployment.</div></div></section></div></main>;
}
