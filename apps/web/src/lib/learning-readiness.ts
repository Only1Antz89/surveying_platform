import { and, eq, inArray, sql } from "drizzle-orm";
import { programmeStatus } from "@surveynt/learning";
import { platformStaff, type Database } from "@surveynt/db";
import { loadPublishedPolicy } from "./learning";

export type ReadinessCheck = { key: string; ok: boolean; detail: string };

const reviewerRoles = ["privacy_reviewer", "technical_reviewer", "release_manager"] as const;
const roleOf = (url: string | undefined) => { try { return url ? decodeURIComponent(new URL(url).username) || null : null; } catch { return null; } };

/**
 * Read-only check of everything shared learning needs before SHARED_LEARNING_ENABLED
 * may be set. Run with the owner connection. It changes nothing and prints no secrets.
 */
export async function learningActivationReadiness(admin: Database, env: Record<string, string | undefined> = process.env) {
  const checks: ReadinessCheck[] = [];
  const rows = async <T>(query: ReturnType<typeof sql>) => (await admin.execute(query) as unknown as { rows: T[] }).rows;

  const [objects] = await rows<{ restricted: string | null; shared: string | null; write: boolean; read: boolean }>(sql`select to_regnamespace('learning_restricted')::text as restricted, to_regnamespace('learning_shared')::text as shared,
    exists(select 1 from pg_roles where rolname = 'surveynt_learning_write') as write, exists(select 1 from pg_roles where rolname = 'surveynt_learning_read') as read`);
  const migrated = Boolean(objects.restricted && objects.shared && objects.write && objects.read);
  checks.push({ key: "migrations", ok: migrated, detail: migrated ? "Learning schemas and group roles exist (migrations 0010, 0023-0025)." : "Apply migrations through 0025 first." });

  const appRole = roleOf(env.DATABASE_APP_URL ?? env.DATABASE_URL), adminRole = roleOf(env.DATABASE_ADMIN_URL), learningRole = roleOf(env.DATABASE_LEARNING_URL);
  const logins = migrated ? await rows<{ name: string; bypass: boolean }>(sql`select r.rolname as name, r.rolbypassrls as bypass from pg_roles r join pg_auth_members m on m.member = r.oid join pg_roles g on g.oid = m.roleid where g.rolname = 'surveynt_learning_write' and r.rolcanlogin`) : [];
  const service = logins.find((login) => login.name === learningRole);
  checks.push({ key: "learning_role", ok: Boolean(service && !service.bypass && learningRole !== appRole && learningRole !== adminRole),
    detail: !learningRole ? "DATABASE_LEARNING_URL is not set." : !service ? "The DATABASE_LEARNING_URL role is not a login member of surveynt_learning_write." : service.bypass ? "The learning role must not have BYPASSRLS." : learningRole === appRole || learningRole === adminRole ? "The learning role must be separate from the application and owner roles." : "Separate learning service login role is a member of surveynt_learning_write." });

  const [app] = migrated && appRole ? await rows<{ exists: boolean; read: boolean | null; write: boolean | null }>(sql`select exists(select 1 from pg_roles where rolname = ${appRole}) as exists,
    case when exists(select 1 from pg_roles where rolname = ${appRole}) then pg_has_role(${appRole}, 'surveynt_learning_read', 'MEMBER') end as read,
    case when exists(select 1 from pg_roles where rolname = ${appRole}) then pg_has_role(${appRole}, 'surveynt_learning_write', 'MEMBER') end as write`) : [];
  checks.push({ key: "app_role", ok: Boolean(app?.exists && app.read && !app.write),
    detail: !app?.exists ? "The DATABASE_APP_URL role was not found." : !app.read ? "Grant surveynt_learning_read to the application role so firms can retrieve released cases." : app.write ? "The application role must never hold surveynt_learning_write." : "Application role can read released cases only." });

  const secret = env.LEARNING_LINEAGE_SECRET ?? "";
  checks.push({ key: "lineage_secret", ok: secret.length >= 32, detail: secret.length >= 32 ? "LEARNING_LINEAGE_SECRET is set (at least 32 characters)." : "Set LEARNING_LINEAGE_SECRET to at least 32 random characters." });

  const policy = migrated ? await loadPublishedPolicy(admin) : null;
  const programme = programmeStatus({ ...env, SHARED_LEARNING_ENABLED: "true" }, policy ? { version: policy.version, status: policy.status, privacyAssessmentRef: policy.privacyAssessmentRef, releaseCriteria: policy.releaseCriteria } : null);
  checks.push({ key: "policy", ok: programme.active, detail: programme.active ? `Policy ${programme.policyVersion} is published with a privacy assessment reference and release criteria.` : programme.reasons.map((reason) => reason.message).join(" ") });

  const staff = await admin.select({ role: platformStaff.role, person: platformStaff.clerkUserId }).from(platformStaff).where(and(eq(platformStaff.active, true), inArray(platformStaff.role, [...reviewerRoles])));
  const missing = reviewerRoles.filter((role) => !staff.some((member) => member.role === role));
  // One platform role per person (unique clerk_user_id), so the three roles are held by different people.
  checks.push({ key: "reviewers", ok: missing.length === 0, detail: missing.length ? `Appoint active platform staff for: ${missing.join(", ")}.` : "Privacy reviewer, technical reviewer and release manager are appointed (different people)." });

  checks.push({ key: "external_approvals", ok: Boolean(policy?.privacyAssessmentRef), detail: "Not checkable by software: the DPIA and legal review must be complete. The policy's privacy assessment reference records that they are." });

  const prerequisitesMet = checks.every((check) => check.ok);
  return { prerequisitesMet, enabled: env.SHARED_LEARNING_ENABLED === "true", nextStep: prerequisitesMet ? (env.SHARED_LEARNING_ENABLED === "true" ? "Active. Firms must still grant scopes individually." : "Set SHARED_LEARNING_ENABLED=true; firms then grant scopes individually.") : "Resolve the failing checks before enabling.", checks };
}
