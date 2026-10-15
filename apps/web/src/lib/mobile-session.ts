import { twoStepSatisfied } from "./two-step-policy";

/** A dedicated mobile JWT proves identity, but only a matching Clerk session proves MFA. */
export function mobileSessionSatisfied(value: unknown, userId: string, organisationId: string) {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  const organisation = session.v === 2
    ? (session.o && typeof session.o === "object" ? (session.o as Record<string, unknown>).id : undefined)
    : session.org_id;
  return session.sub === userId && organisation === organisationId && typeof session.sid === "string" && session.sid.length > 0
    && (session.sts === undefined || session.sts === "active") && twoStepSatisfied(true, session.fva);
}
