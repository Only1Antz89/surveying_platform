import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { apiContext } from "@/lib/access";
import { loadOverviewForOrganisation } from "@/lib/data";
import { ok, problem } from "@/lib/api";
import { jobs } from "@/lib/demo-data";
import { and, count, eq, notInArray } from "drizzle-orm";
import { createDatabase, jobs as jobRecords, withTenant } from "@surveynt/db";

export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (context.role === "surveyor") {
    return withTenant(createDatabase(), context.organisationId, async tx => {
      const own = and(eq(jobRecords.organisationId, context.organisationId), eq(jobRecords.assignedSurveyorId, context.internalUserId!), notInArray(jobRecords.stage, ["paid", "archived"]));
      const [[totals], work] = await Promise.all([
        tx.select({ activeJobs: count() }).from(jobRecords).where(own),
        tx.select({ id: jobRecords.id, reference: jobRecords.reference, service: jobRecords.serviceName, stage: jobRecords.stage, targetDate: jobRecords.targetDate }).from(jobRecords).where(own).limit(20),
      ]);
      return ok({ activeJobs: totals.activeJobs, workQueue: work });
    });
  }
  if (context.demo) return ok({ activeJobs: 18, inspectionsThisWeek: 7, openClients: 42, feesInProgress: 21400, workQueue: jobs.slice(0, 4) }, { demo: true });
  return ok(await loadOverviewForOrganisation(context.organisationId));
}
