import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { auditEvents, createDatabase, organisationOperationalSettings, withTenant } from "@surveynt/db";
import { apiContext, isClerkConfigured } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { workspaceAudit } from "@/lib/workspace-audit";
import { twoStepSatisfied } from "@/lib/two-step-policy";

/** The practice's sign-in policy. */
export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.demo) return ok({ requireTwoStep: false, sessionVerified: false }, { demo: true });
  const [row] = await withTenant(createDatabase(), context.organisationId, (tx) => tx.select({ requireTwoStep: organisationOperationalSettings.requireTwoStep }).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, context.organisationId)).limit(1));
  const session = isClerkConfigured() ? await auth() : null;
  return ok({ requireTwoStep: row?.requireTwoStep ?? false, sessionVerified: twoStepSatisfied(true, session?.factorVerificationAge) });
}

/** Owners require or relax two-step sign-in. Turning it on needs a session verified with a second step, so no one locks themselves out. */
export async function PATCH(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.accessLevel !== "full" || context.role !== "owner") return problem(403, "forbidden", "Only the practice owner can change the sign-in policy.");
  const parsed = await parseBody(request, z.object({ requireTwoStep: z.boolean() }));
  if (!parsed.success) return problem(422, "invalid_policy", "Choose whether two-step sign-in is required.");
  if (context.demo) return ok(parsed.data, { demo: true, persisted: false });
  if (parsed.data.requireTwoStep && !twoStepSatisfied(true, (await auth()).factorVerificationAge)) return problem(409, "verify_first", "Set up two-step sign-in on your own account and sign in with it before requiring it for everyone.");
  await withTenant(createDatabase(), context.organisationId, async (tx) => {
    await tx.insert(organisationOperationalSettings).values({ organisationId: context.organisationId, requireTwoStep: parsed.data.requireTwoStep }).onConflictDoUpdate({ target: organisationOperationalSettings.organisationId, set: { requireTwoStep: parsed.data.requireTwoStep, updatedAt: new Date() } });
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "security.two_step_policy_changed", resourceType: "organisation", resourceId: context.organisationId, metadata: parsed.data }));
  });
  return ok(parsed.data);
}
