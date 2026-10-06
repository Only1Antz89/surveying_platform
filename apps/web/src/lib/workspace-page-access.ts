import { notFound } from "next/navigation";
import { isManagementRole } from "@surveynt/domain";
import { requireFirmAccess } from "./access";

/** Page gates complement API checks; hiding a menu is not authorization. */
export async function requireWorkspacePageAccess(slug: string, area: string) {
  const context = await requireFirmAccess(slug);
  if (context.userRole === "finance" && !["account", "finance", "overview", ""].includes(area)) notFound();
  if (["settings", "performance", "demo"].includes(area) && !isManagementRole(context.userRole)) notFound();
  if (area === "team" && !["owner", "administrator"].includes(context.userRole)) notFound();
  return context;
}
