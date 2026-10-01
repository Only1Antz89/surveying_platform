import { and, eq } from "drizzle-orm";
import { auditEvents, backgroundJobs, createDatabase } from "@surveynt/db";
import { platformApiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";

export async function POST(_: Request, route: RouteContext<"/api/platform/background-jobs/[jobId]/retry">) {
  const operator = await platformApiContext();
  if (!operator) return problem(401, "unauthorised", "Platform staff authentication is required.");
  if (operator.role !== "super_admin" && operator.role !== "support") return problem(403, "forbidden", "Your platform role cannot retry failed operational work.");
  const { jobId } = await route.params;
  if (operator.demo) return ok({ id: jobId, status: "queued" }, { demo: true, persisted: false });
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [job] = await db.update(backgroundJobs).set({ status: "queued", attempts: 0, availableAt: new Date(), failedAt: null, completedAt: null, error: null, updatedAt: new Date() }).where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.queue, "email"), eq(backgroundJobs.status, "failed"))).returning();
  if (!job) return problem(409, "job_not_retryable", "This email delivery is no longer in a failed state.");
  await db.insert(auditEvents).values({ organisationId: job.organisationId, platformStaffId: operator.platformStaffId, action: "notification.email_retry_queued", resourceType: "background_job", resourceId: job.id, metadata: { type: job.type } });
  return ok({ id: job.id, status: job.status });
}
