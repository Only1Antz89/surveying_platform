import { notFound } from "next/navigation";
import { isManagementRole } from "@surveynt/domain";
import { after } from "next/server";
import { requireFirmAccess } from "./access";
import { recordFeatureUse } from "./feature-usage";

/** Page gates complement API checks; hiding a menu is not authorization. */
export async function requireWorkspacePageAccess(slug: string, area: string) {
  const context = await requireFirmAccess(slug);
  if (context.userRole === "finance" && !["account", "finance", "overview", ""].includes(area)) notFound();
  if (["settings", "performance", "demo"].includes(area) && !isManagementRole(context.userRole)) notFound();
  if (["team","staff","fieldwork","services","locations"].includes(area) && !isManagementRole(context.userRole)) notFound();
  if (context.workspaceMode === "manager" && ["locations", "routes", "services"].includes(area)) notFound();
  if (context.userId !== "demo_user") {
    try { after(() => recordFeatureUse(context.organisationId, area)); } catch { /* outside a request (tests, prerender) */ }
  }
  return context;
}
