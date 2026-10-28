import { notFound } from "next/navigation";
import { requirePlatformAccess } from "@/lib/access";
import { CapabilityPanel } from "@/components/capability-panel";
import { ConnectionsPanel } from "@/components/connections-panel";
export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const operator = await requirePlatformAccess();
  if (operator.role !== "super_admin") notFound();
  const services = [
    [
      "Clerk account sync",
      Boolean(process.env.CLERK_WEBHOOK_SECRET && process.env.CLERK_SECRET_KEY),
    ],
    ["Tenant database", Boolean(process.env.DATABASE_APP_URL)],
    ["Platform database", Boolean(process.env.DATABASE_ADMIN_URL)],
    [
      "Subscription billing",
      Boolean(
        process.env.STRIPE_SECRET_KEY &&
          process.env.STRIPE_WEBHOOK_SECRET &&
          process.env.STRIPE_BASE_PRICE_ID,
      ),
    ],
    [
      "Transactional email",
      Boolean(process.env.SMTP2GO_API_KEY && process.env.SMTP2GO_SENDER),
    ],
    ["Scheduler", Boolean(process.env.CRON_SECRET)],
  ] as const;
  return (
    <main className="page platform-console">
      <header className="console-heading">
        <div>
          <h1>Integrations</h1>
          <p>
            Configure platform services and review their operational readiness.
          </p>
        </div>
      </header>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Service configuration</h2>
            <p>
              Configured credentials do not confirm a working connection. No
              secrets are shown.
            </p>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Configuration</th>
              <th>Connection verification</th>
            </tr>
          </thead>
          <tbody>
            {services.map(([name, configured]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{configured ? "Configured" : "Configuration required"}</td>
                <td>Not verified by this check</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <CapabilityPanel scope="platform" />
      <ConnectionsPanel />
    </main>
  );
}
