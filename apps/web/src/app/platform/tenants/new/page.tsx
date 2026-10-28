import { platformInvitationsConfigured } from "@/lib/platform-application-url";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAccess } from "@/lib/access";
import { CustomerAccountForm } from "@/components/customer-account-form";
export const metadata = { title: "Add customer" };
export default async function Page() {
  const c = await requirePlatformAccess();
  if (c.role !== "super_admin") notFound();
  const ready = platformInvitationsConfigured();
  return (
    <main className="page platform-console">
      <Link href="/platform/tenants" className="panel-link">
        Back to customers
      </Link>
      <header className="console-heading">
        <div>
          <h1>Add customer</h1>
          <p>Create an account manually or let customers self-onboard.</p>
        </div>
        <Link className="button button-secondary" href="/sign-up">
          Open customer self-signup
        </Link>
      </header>
      {!ready ? (
        <p className="console-notice">
          Account synchronisation must be configured before creating customers
          and sending owner invitations. Review{" "}
          <Link href="/platform/integrations">Integrations</Link>.
        </p>
      ) : null}
      <CustomerAccountForm disabled={!ready} />
    </main>
  );
}
