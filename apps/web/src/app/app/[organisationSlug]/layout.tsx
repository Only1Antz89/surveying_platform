import {Suspense} from "react";
import {WorkspaceProvider} from "@/components/workspace-provider";
import {createDatabase,withTenant,organisationOperationalSettings} from "@surveynt/db";
import {eq} from "drizzle-orm";
import Link from "@/components/workspace-link";
import { CreditCard, ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { CheckoutButton } from "@/components/checkout-button";
import { requireFirmAccess } from "@/lib/access";

export default async function FirmLayout({ children, params }: { children: React.ReactNode; params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  const context = await requireFirmAccess(organisationSlug);
  const polishEnabled = process.env.SURVEYNT_NEW_UI !== "false";
  const [branding]=context.userId==="demo_user"?[]:await withTenant(createDatabase(),context.organisationId,tx=>tx.select({value:organisationOperationalSettings.customerBranding}).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,context.organisationId)).limit(1));
  const trialEnds = context.trialEndsAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) ?? null;
  let content = children;
  if (context.accessLevel === "billing_only") content = <main className="page"><section className="panel"><div className="empty-state"><CreditCard size={28} color="#3b82f6" /><strong>Billing setup is required</strong><span>Add a payment method to start or restore workspace access.</span>{context.userRole === "owner" ? <CheckoutButton seats={1} /> : <span>Ask a practice owner to complete billing.</span>}</div></section></main>;
  if (context.accessLevel === "blocked") content = <main className="page"><section className="panel"><div className="empty-state"><ShieldAlert size={28} color="#b83847" /><strong>Workspace access is suspended</strong><span>Contact Surveynt support or your practice owner before trying again.</span><Link className="button button-secondary" href="/">Return to Surveynt</Link></div></section></main>;
  if (context.accessLevel === "read_only") content = <><div className="demo-banner">Payment is overdue and the grace period has ended. This workspace is read-only until billing is restored.</div>{children}</>;
  return <Suspense><WorkspaceProvider slug={organisationSlug} userId={context.userId} organisationId={context.organisationId} actorRole={context.actorRole}><AppShell mode="firm" slug={organisationSlug} polishEnabled={polishEnabled} workspace={{
    name: branding?.value.displayName || context.organisationName,
    logoUrl:branding?.value.logoUrl??null,
    region: context.organisationRegion,
    userName: context.userName,
    userRole: context.userRole,actorRole:context.actorRole,workspaceMode:context.workspaceMode,
    trialEnds,
    demo: context.isDemo,
  }}>{content}</AppShell></WorkspaceProvider></Suspense>;
}
