import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { organisationOperationalSettings, users, userProfiles, type TenantTransaction } from "@surveynt/db";
import { canonicalJson } from "@surveynt/assistant";

const fingerprint = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export async function reportIdentityEvidence(tx: TenantTransaction, organisationId: string, practitionerId?: string | null) {
  const [settings] = await tx.select({ identity: organisationOperationalSettings.reportIdentity }).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, organisationId)).for("share").limit(1);
  let practitioner: { id: string; name: string | null; ricsNumber: string | null; fingerprint: string } | undefined;
  if (practitionerId) {
    await tx.execute(sql`select set_config('app.current_user_id', ${practitionerId}, true)`);
    const [user] = await tx.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, practitionerId)).for("share").limit(1);
    const [profile] = await tx.select({ reportName: userProfiles.reportName, ricsNumber: userProfiles.ricsNumber }).from(userProfiles).where(and(eq(userProfiles.userId, practitionerId))).for("share").limit(1);
    const value = { name: profile?.reportName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null, ricsNumber: profile?.ricsNumber ?? null };
    practitioner = { id: practitionerId, ...value, fingerprint: fingerprint(value) };
  }
  return { practitioner, firm: settings ? { id: organisationId, ...settings.identity, fingerprint: fingerprint(settings.identity) } : undefined };
}
