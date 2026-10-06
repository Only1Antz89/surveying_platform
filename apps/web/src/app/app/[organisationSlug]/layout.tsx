import Link from "next/link";
import { CreditCard, ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { CheckoutButton } from "@/components/checkout-button";
import { requireFirmAccess } from "@/lib/access";
import { createDatabase,entitlements,withTenant } from "@surveynt/db";
import { and,eq } from "drizzle-orm";

export default async function FirmLayout({ children, params }: { children: React.ReactNode; params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  const context = await requireFirmAccess(organisationSlug);
  const polishEnabled=context.userId==="demo_user"||context.isDemo||(await withTenant(createDatabase(),context.organisationId,tx=>tx.select({enabled:entitlements.enabled}).from(entitlements).where(and(eq(entitlements.organisationId,context.organisationId),eq(entitlements.key,"product_polish"))).limit(1)))[0]?.enabled===true;
  const trialEnds = context.trialEndsAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) ?? null;
  let content = children;
  if (context.accessLevel === "billing_only") content = <main className="page"><section className="panel"><div className="empty-state"><CreditCard size={28} color="#3b82f6" /><strong>Billing setup is required</strong><span>Add a payment method to start or restore workspace access.</span>{context.userRole === "owner" ? <CheckoutButton seats={1} /> : <span>Ask a practice owner to complete billing.</span>}</div></section></main>;
  if (context.accessLevel === "blocked") content = <main className="page"><section className="panel"><div className="empty-state"><ShieldAlert size={28} color="#b83847" /><strong>Workspace access is suspended</strong><span>Contact Surveynt support or your practice owner before trying again.</span><Link className="button button-secondary" href="/">Return to Surveynt</Link></div></section></main>;
  if (context.accessLevel === "read_only") content = <><div className="demo-banner">Payment is overdue and the grace period has ended. This workspace is read-only until billing is restored.</div>{children}</>;
  return <AppShell mode="firm" slug={organisationSlug} polishEnabled={polishEnabled} workspace={{
    name: context.organisationName,
    region: context.organisationRegion,
    userName: context.userName,
    userRole: context.userRole,
    trialEnds,
    demo: context.isDemo,
  }}>{content}</AppShell>;
}
