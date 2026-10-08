import type { OrganisationRole } from "@surveynt/domain";
import { and, eq } from "drizzle-orm";
import { createDatabase, supportSessions } from "@surveynt/db";
import { apiContext, platformApiContext } from "./access";
import { demoSessionActive, demoStore } from "./demo-store";

type FirmContext = NonNullable<Awaited<ReturnType<typeof apiContext>>>;
export type ClientApiContext = Omit<FirmContext, "role" | "internalUserId" | "demo"> & { role: OrganisationRole; internalUserId: string | null; demo: boolean } & { platformStaffId?: string; supportSessionId?: string };

/** A support URL is usable only with the authenticated operator's active session. */
export async function clientApiContext(request: Request): Promise<ClientApiContext | null> {
  const match = new URL(request.url).pathname.match(/^\/api\/platform\/support\/([^/]+)\/clients(?:\/|$)/);
  if (!match) return apiContext(request);
  const operator = await platformApiContext();
  if (!operator || !["super_admin", "support"].includes(operator.role)) return null;
  let organisationId: string, permission: "read" | "write";
  if (operator.demo) {
    const session = (await demoStore.snapshot()).sessions.find(item => item.id === match[1]);
    if (!session || !demoSessionActive(session, operator.platformStaffId, request.method)) return null;
    if (session.breakGlass && operator.role !== "super_admin") return null;
    organisationId = session.organisationId; permission = session.permission;
  } else {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(match[1])) return null;
    const db = createDatabase(process.env.DATABASE_ADMIN_URL);
    const [session] = await db.select().from(supportSessions).where(and(eq(supportSessions.id, match[1]), eq(supportSessions.platformStaffId, operator.platformStaffId))).limit(1);
    if (!session || session.platformStaffId !== operator.platformStaffId || session.revokedAt || session.expiresAt <= new Date()) return null;
    if (session.breakGlass && operator.role !== "super_admin") return null;
    if (session.permission === "write" && !session.approvedByUserId && !session.breakGlass) return null;
    if (session.permission === "read" && request.method !== "GET") return null;
    organisationId = session.organisationId; permission = session.permission;
  }
  return { userId: operator.userId, internalUserId: null, clerkOrganisationId: "support", organisationId, role: "administrator", canRecordSurvey: false, canApproveReports: false, accessLevel: permission === "write" ? "full" : "read_only", demo: operator.demo, platformStaffId: operator.platformStaffId, supportSessionId: match[1] };
}
export function clientAuditActor(context: ClientApiContext) {
  return { actorUserId: context.internalUserId, ...(context.platformStaffId ? { platformStaffId: context.platformStaffId, supportSessionId: context.supportSessionId } : {}) };
}
export function clientDatabase(context: ClientApiContext) {
  return context.platformStaffId ? createDatabase(process.env.DATABASE_ADMIN_URL) : createDatabase();
}
