import type { Tenant } from "./demo-data";
export type RegisterQuery = {
  q: string;
  status: string;
  account: string;
  plan: string;
  demo: string;
  sort: string;
  direction: string;
  page: number;
};
export function registerQuery(params: URLSearchParams): RegisterQuery {
  return {
    q: (params.get("q") ?? "").slice(0, 160),
    status: ["provisioning", "suspended", "closed"].includes(
      params.get("status") ?? "",
    )
      ? ""
      : (params.get("status") ?? ""),
    account:
      params.get("account") ??
      (["provisioning", "suspended", "closed"].includes(
        params.get("status") ?? "",
      )
        ? params.get("status")!
        : ""),
    plan: params.get("plan") ?? "",
    demo: params.get("demo") ?? "",
    sort: [
      "name",
      "plan",
      "subscription",
      "onboarding",
      "seats",
      "lastActive",
    ].includes(params.get("sort") ?? "")
      ? params.get("sort")!
      : "name",
    direction: params.get("direction") === "desc" ? "desc" : "asc",
    page: Math.max(
      1,
      Math.min(100000, Math.floor(Number(params.get("page"))) || 1),
    ),
  };
}
export function filterCustomers(tenants: Tenant[], query: RegisterQuery) {
  return tenants
    .filter(
      (t) =>
        `${t.name} ${t.owner}`.toLowerCase().includes(query.q.toLowerCase()) &&
        (!query.status || t.subscription === query.status) &&
        (!query.account || t.status === query.account) &&
        (!query.plan || t.plan === query.plan) &&
        (!query.demo || (query.demo === "demo" ? t.isDemo : !t.isDemo)),
    )
    .sort((a, b) => {
      const key = query.sort as keyof Tenant;
      const av = key === "lastActive" ? (a.lastActiveAt ?? "") : a[key];
      const bv = key === "lastActive" ? (b.lastActiveAt ?? "") : b[key];
      return (
        (typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av ?? "").localeCompare(String(bv ?? ""), "en-GB", {
              numeric: true,
            })) * (query.direction === "desc" ? -1 : 1) ||
        a.id.localeCompare(b.id)
      );
    });
}
