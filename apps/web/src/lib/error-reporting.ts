import { createHash } from "node:crypto";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { createDatabase, platformErrorEvents } from "@surveynt/db";

// Built-in error reporting. Only safe, low-cardinality details are kept: the route
// file path, method, error type and a scrubbed message. Request bodies, headers,
// cookies, query strings and stack traces are never stored.

export type SafeErrorEvent = { fingerprint: string; routePath: string; routeType: string; method: string; errorName: string; message: string; digest: string | null };
type RequestInfo = { path: string; method: string };
type ContextInfo = { routePath?: string; routeType?: string };

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const url = /https?:\/\/[^\s'"]+/g;
const secretLike = /\b(sk|pk|rk|whsec|key|token|secret)[_-][A-Za-z0-9_-]{8,}\b/gi;
const longNumber = /\b\d{4,}\b/g;

/** Removes identifiers, contact details, links and anything that looks like a credential. */
export function scrubMessage(message: string) {
  return message.replace(url, "<url>").replace(email, "<email>").replace(secretLike, "<secret>").replace(uuid, "<id>").replace(longNumber, "<n>").replace(/\s+/g, " ").trim().slice(0, 300) || "No message";
}

export function safeErrorEvent(error: unknown, request: RequestInfo, context: ContextInfo): SafeErrorEvent {
  const errorName = (error instanceof Error ? error.name : typeof error).replace(/[^\w]/g, "").slice(0, 60) || "Error";
  const message = scrubMessage(error instanceof Error ? error.message : String(error));
  const digest = typeof error === "object" && error !== null && "digest" in error && /^[\w-]{1,64}$/.test(String(error.digest)) ? String(error.digest) : null;
  // Route file paths (/app/jobs/[id]) are safe; raw request paths can carry identifiers.
  const routePath = (context.routePath ?? request.path.split("?")[0].replace(uuid, "[id]")).slice(0, 200);
  const method = /^[A-Z]{3,7}$/.test(request.method) ? request.method : "OTHER";
  const routeType = ["render", "route", "action", "proxy"].includes(context.routeType ?? "") ? context.routeType! : "unknown";
  const fingerprint = createHash("sha256").update(`${routePath}|${method}|${errorName}|${message}`).digest("hex");
  return { fingerprint, routePath, routeType, method, errorName, message, digest };
}

const adminDb = () => process.env.DATABASE_ADMIN_URL ? createDatabase(process.env.DATABASE_ADMIN_URL) : null;

/** Records or re-opens a grouped error. Never throws, so reporting cannot break a response. */
export async function recordServerError(error: unknown, request: RequestInfo, context: ContextInfo) {
  const db = adminDb();
  if (!db) return;
  const event = safeErrorEvent(error, request, context);
  try {
    await db.insert(platformErrorEvents).values(event).onConflictDoUpdate({
      target: platformErrorEvents.fingerprint,
      set: { occurrences: sql`${platformErrorEvents.occurrences} + 1`, lastSeenAt: sql`now()`, digest: event.digest, resolvedAt: null, resolvedByStaffId: null },
    });
  } catch {
    // Reporting is best effort.
  }
}

export async function listServerErrors() {
  const db = adminDb();
  if (!db) return [];
  const rows = await db.select().from(platformErrorEvents).orderBy(sql`${platformErrorEvents.resolvedAt} is not null`, desc(platformErrorEvents.lastSeenAt)).limit(200);
  return rows.map((row) => ({ ...row, firstSeenAt: row.firstSeenAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null }));
}

export async function resolveServerError(id: string, staffId: string) {
  const db = adminDb();
  if (!db) return null;
  const [row] = await db.update(platformErrorEvents).set({ resolvedAt: new Date(), resolvedByStaffId: staffId }).where(eq(platformErrorEvents.id, id)).returning({ id: platformErrorEvents.id });
  return row ?? null;
}

export async function openServerErrorCount() {
  const db = adminDb();
  if (!db) return 0;
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(platformErrorEvents).where(isNull(platformErrorEvents.resolvedAt));
  return row?.count ?? 0;
}
