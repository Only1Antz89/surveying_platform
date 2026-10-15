import { createHash } from "node:crypto";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { createDatabase, platformErrorEvents } from "@surveynt/db";

// Built-in error reporting. Only safe, low-cardinality details are kept: the route
// file path, method and allowlisted error type. Exception details are withheld. Request bodies, headers,
// cookies, query strings and stack traces are never stored.

export type SafeErrorEvent = { fingerprint: string; routePath: string; routeType: string; method: string; errorName: string; message: string; digest: string | null };
type RequestInfo = { path: string; method: string };
type ContextInfo = { routePath?: string; routeType?: string };

const errorNames = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError"]);
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
export const withheldErrorMessage = "Exception details withheld to protect confidential data.";

/** Exception prose, custom names and digests can contain records or credentials. Never store them. */
export function safeErrorEvent(error: unknown, request: RequestInfo, context: ContextInfo): SafeErrorEvent {
  const errorName = error instanceof Error && errorNames.has(error.name) ? error.name : "Error";
  // Only the framework's route template is diagnostic context; raw URLs can contain names and tokens.
  const routePath = context.routePath?.startsWith("/") && context.routePath.length <= 200 && !/[?#\r\n]/.test(context.routePath) ? context.routePath : "[unknown]";
  const method = methods.has(request.method) ? request.method : "OTHER";
  const routeType = ["render", "route", "action", "proxy"].includes(context.routeType ?? "") ? context.routeType! : "unknown";
  const fingerprint = createHash("sha256").update(`${routePath}|${method}|${errorName}`).digest("hex");
  return { fingerprint, routePath, routeType, method, errorName, message: withheldErrorMessage, digest: null };
}

/** Old rows can predate the safe writer; never return their exception data to the UI. */
export function safeStoredErrorEvent(row: SafeErrorEvent): SafeErrorEvent {
  const current = row.fingerprint === createHash("sha256").update(`${row.routePath}|${row.method}|${row.errorName}`).digest("hex") && row.message === withheldErrorMessage && row.digest === null;
  const error = new Error(); error.name = row.errorName;
  return safeErrorEvent(error, {path:"", method:row.method}, {routePath:current ? row.routePath : undefined, routeType:row.routeType});
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
      set: { occurrences: sql`${platformErrorEvents.occurrences} + 1`, lastSeenAt: sql`now()`, message: event.message, errorName: event.errorName, routePath: event.routePath, method: event.method, routeType: event.routeType, digest: null, resolvedAt: null, resolvedByStaffId: null },
    });
  } catch {
    // Reporting is best effort.
  }
}

export async function listServerErrors() {
  const db = adminDb();
  if (!db) return [];
  const rows = await db.select().from(platformErrorEvents).orderBy(sql`${platformErrorEvents.resolvedAt} is not null`, desc(platformErrorEvents.lastSeenAt)).limit(200);
  return rows.map((row) => ({ ...row, ...safeStoredErrorEvent(row), firstSeenAt: row.firstSeenAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null }));
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
