import { and, isNotNull, ne } from "drizzle-orm";
import { createDatabase, customerProvisioning } from "@surveynt/db";
import { ProvisioningRecovery } from "@/components/provisioning-recovery";
import { Suspense } from "react";
import { TenantDirectory } from "@/components/tenant-directory";
import { loadTenants } from "@/lib/data";
import { requirePlatformAccess } from "@/lib/access";
export const metadata = { title: "Customers" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const operator = await requirePlatformAccess();
  const tenants = await loadTenants();
  const pending =
    operator.role === "super_admin" && operator.userId !== "demo_platform_user"
      ? await createDatabase(process.env.DATABASE_ADMIN_URL)
          .select()
          .from(customerProvisioning)
          .where(
            and(
              isNotNull(customerProvisioning.requestedBy),
              ne(customerProvisioning.state, "complete"),
            ),
          )
      : [];
  return (
    <main className="page platform-console">
      <ProvisioningRecovery
        requests={pending.map((r) => ({
          id: r.id,
          name: r.input.firmName ?? "Customer setup",
          ownerEmail: r.ownerEmail,
          state: r.state,
        }))}
      />
      <Suspense fallback={<p role="status">Loading customers…</p>}>
        <TenantDirectory
          tenants={tenants}
          canManage={operator.role === "super_admin"}
        />
      </Suspense>
    </main>
  );
}
