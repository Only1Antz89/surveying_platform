import { requirePlatformAccess } from "@/lib/access";
import { canManageEngagement, lifecycleStages } from "@/lib/customer-lifecycle";
import { loadLifecycleData } from "@/lib/customer-lifecycle-data";
import { CustomerEngagement } from "@/components/customer-engagement";
export const metadata = { title: "Customer engagement" };
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const operator = await requirePlatformAccess();
  if (!canManageEngagement(operator.role))
    return (
      <main className="page">
        <h1>Customer engagement</h1>
        <p>
          Engagement access is available to super administrators, support and
          billing staff.
        </p>
      </main>
    );
  const params = await searchParams;
  const stage =
    typeof params.stage === "string" &&
    [...lifecycleStages, "prospect"].includes(
      params.stage as (typeof lifecycleStages)[number],
    )
      ? params.stage
      : "";
  const query = {
    q: typeof params.q === "string" ? params.q.slice(0, 160) : "",
    stage,
    attention: params.attention === "yes",
    includeDemo: params.demo === "include",
  };
  let data;
  try {
    data = await loadLifecycleData(
      query.includeDemo,
      operator.userId === "demo_platform_user",
    );
  } catch {
    return (
      <main className="page">
        <h1>Customer engagement</h1>
        <p role="alert">
          Customer engagement could not load. Please refresh or try again later.
        </p>
      </main>
    );
  }
  return (
    <main className="page platform-console">
      <CustomerEngagement
        key={JSON.stringify(query)}
        data={data}
        operatorId={operator.platformStaffId}
        query={query}
      />
    </main>
  );
}
