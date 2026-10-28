import { platformInvitationsConfigured } from "@/lib/platform-application-url";
import { requirePlatformAccess } from "@/lib/access";
import { loadPlatformStaff } from "@/lib/data";
import { listStaffInvitations } from "@/lib/platform-invitations";
import { PlatformStaffManager } from "@/components/platform-staff-manager";
import { StaffInvitations } from "@/components/staff-invitations";
import { notFound } from "next/navigation";
export const metadata = { title: "Platform users" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const c = await requirePlatformAccess();
  if (c.role !== "super_admin") notFound();
  const staff = await loadPlatformStaff();
  const invitations =
    c.userId === "demo_platform_user" ? [] : await listStaffInvitations();
  return (
    <main className="page platform-console">
      <header className="console-heading">
        <div>
          <h1>Platform users</h1>
          <p>Manage internal Surveynt access without customer membership.</p>
        </div>
      </header>
      <StaffInvitations
        invitations={invitations.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          expiresAt: i.expiresAt.toISOString(),
          acceptedAt: i.acceptedAt?.toISOString() ?? null,
          revokedAt: i.revokedAt?.toISOString() ?? null,
          delivered: Boolean(i.clerkInvitationId),
        }))}
        configured={platformInvitationsConfigured()}
      />
      <PlatformStaffManager
        staff={staff}
        currentStaffId={c.platformStaffId}
        canManage
      />
    </main>
  );
}
