import Link from "next/link";
import { CreditCard } from "lucide-react";
import { canManageBilling } from "@surveynt/domain";
import { StatusDot } from "@surveynt/ui";
import { BillingPortalButton } from "@/components/billing-portal-button";
import { PageHeader } from "@/components/page-header";
import { requireFirmAccess } from "@/lib/access";
import { loadBillingSummary } from "@/lib/data";

export const metadata = { title: "Billing" };

const labels = { incomplete: "Setup required", trialing: "Trialing", active: "Active", past_due: "Past due", unpaid: "Unpaid", canceled: "Canceled" } as const;
const tones = { incomplete: "slate", trialing: "blue", active: "green", past_due: "amber", unpaid: "amber", canceled: "slate" } as const;
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : "—";

export default async function BillingPage({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  const [billing, access] = await Promise.all([loadBillingSummary(organisationSlug), requireFirmAccess(organisationSlug)]);
  const canManage = canManageBilling(access.userRole);
  return <main className="page"><PageHeader title="Billing" description="Your subscription, seats and payment administration." /><div className="settings-grid"><nav className="settings-nav" aria-label="Settings"><Link href={`/app/${organisationSlug}/settings`}>Practice details</Link><Link className="active" href={`/app/${organisationSlug}/settings/billing`}>Billing</Link><Link href={`/app/${organisationSlug}/settings/ai`}>AI and assistant</Link><Link href={`/app/${organisationSlug}/team`}>Security</Link></nav><div className="billing-stack">
    <section className="panel"><div className="panel-header"><div><h2>Subscription</h2><p>{billing.configured ? `${billing.planKey.charAt(0).toUpperCase()}${billing.planKey.slice(1)} plan` : "Billing has not been set up for this workspace."}</p></div><StatusDot tone={tones[billing.status]}>{labels[billing.status]}</StatusDot></div><div className="billing-summary-grid"><div><span>Seats</span><strong>{billing.activeMembers} active / {billing.seats} included</strong></div><div><span>Trial ends</span><strong>{date(billing.trialEndsAt)}</strong></div><div><span>Current period ends</span><strong>{date(billing.currentPeriodEndsAt)}</strong></div><div><span>Grace period ends</span><strong>{date(billing.graceEndsAt)}</strong></div></div><div className="form-section billing-footer">{billing.cancelAtPeriodEnd ? <p className="form-error">This subscription is scheduled to cancel at the end of its current period.</p> : <span />}{billing.configured ? <BillingPortalButton disabled={!canManage} /> : canManage ? <Link className="button button-primary" href="/trial/checkout"><CreditCard size={15} />Set up billing</Link> : null}</div></section>
    <aside className="panel"><div className="panel-header"><div><h2>Payment details and invoices</h2><p>Card details remain in Stripe and are never stored by this application.</p></div><CreditCard size={17} color="#3b82f6" /></div><div className="panel-body"><span className="cell-sub">Open the secure billing portal to update payment details, download invoices or cancel the subscription.</span></div></aside>
  </div></div></main>;
}
