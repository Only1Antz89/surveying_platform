import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auditEvents, createDatabase, onboardingSteps, organisationBranding, organisationMemberships, organisations, users } from "@surveynt/db";
import { ok, parseBody, problem } from "@/lib/api";

const startSchema = z.object({
  firmName: z.string().trim().min(2).max(160),
  practiceType: z.enum(["residential-building-surveying", "commercial-building-surveying", "valuation", "multi-disciplinary"]),
  teamSize: z.enum(["1-5", "6-15", "16-50", "51+"]),
  region: z.enum(["London", "South East England", "South West England", "Midlands", "North of England", "Wales", "Scotland", "Northern Ireland"]),
});

const seatsForTeamSize = { "1-5": 5, "6-15": 15, "16-50": 50, "51+": 100 } as const;

export async function POST(request: Request) {
  const session = await auth();
  if (!session.userId) return problem(401, "unauthorised", "A verified account is required before creating a workspace.");
  const parsed = await parseBody(request, startSchema);
  if (!parsed.success) return problem(400, "invalid_request", "The practice details are invalid.", parsed.error.flatten());
  if (!process.env.DATABASE_ADMIN_URL) return problem(503, "provisioning_unavailable", "Workspace provisioning is not configured.");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  if (session.orgId) {
    const [existing] = await db.select({ id: organisations.id, slug: organisations.slug, clerkOrganisationId: organisations.clerkOrganisationId }).from(organisations).where(eq(organisations.clerkOrganisationId, session.orgId)).limit(1);
    if (existing) return ok({ ...existing, seats: seatsForTeamSize[parsed.data.teamSize], existing: true });
  }
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (!user || !email) return problem(400, "verified_email_required", "A verified primary email address is required before creating a workspace.");
  const clerk = await clerkClient();
  const clerkOrganisation = await clerk.organizations.createOrganization({ name: parsed.data.firmName, createdBy: session.userId, publicMetadata: { surveyntPracticeType: parsed.data.practiceType, surveyntRegion: parsed.data.region, surveyntTeamSize: parsed.data.teamSize } });
  const result = await db.transaction(async (tx) => {
    const [internalUser] = await tx.insert(users).values({ clerkUserId: session.userId, email: email.toLowerCase(), firstName: user.firstName, lastName: user.lastName }).onConflictDoUpdate({ target: users.clerkUserId, set: { email: email.toLowerCase(), firstName: user.firstName, lastName: user.lastName, updatedAt: new Date() } }).returning({ id: users.id });
    const [organisation] = await tx.insert(organisations).values({ clerkOrganisationId: clerkOrganisation.id, name: parsed.data.firmName, slug: clerkOrganisation.slug ?? `practice-${clerkOrganisation.id.slice(-8)}`, practiceType: parsed.data.practiceType, region: parsed.data.region, status: "provisioning" }).onConflictDoUpdate({ target: organisations.clerkOrganisationId, set: { name: parsed.data.firmName, practiceType: parsed.data.practiceType, region: parsed.data.region, updatedAt: new Date() } }).returning();
    await tx.insert(organisationMemberships).values({ organisationId: organisation.id, userId: internalUser.id, role: "owner", active: true }).onConflictDoUpdate({ target: [organisationMemberships.organisationId, organisationMemberships.userId], set: { role: "owner", active: true, updatedAt: new Date() } });
    await tx.insert(organisationBranding).values({ organisationId: organisation.id, tradingName: parsed.data.firmName, supportEmail: email.toLowerCase(), accentColour: "#3b82f6" }).onConflictDoUpdate({ target: organisationBranding.organisationId, set: { tradingName: parsed.data.firmName, supportEmail: email.toLowerCase(), updatedAt: new Date() } });
    await tx.insert(onboardingSteps).values([{ organisationId: organisation.id, key: "practice_details", completedAt: new Date(), completedByUserId: internalUser.id }, { organisationId: organisation.id, key: "billing" }, { organisationId: organisation.id, key: "services" }, { organisationId: organisation.id, key: "first_teammate" }]).onConflictDoNothing();
    await tx.insert(auditEvents).values({ organisationId: organisation.id, actorUserId: internalUser.id, action: "onboarding.started", resourceType: "organisation", resourceId: organisation.id, metadata: { practiceType: parsed.data.practiceType, region: parsed.data.region, teamSize: parsed.data.teamSize } });
    return organisation;
  });
  return ok({ id: result.id, slug: result.slug, clerkOrganisationId: clerkOrganisation.id, seats: seatsForTeamSize[parsed.data.teamSize], existing: false });
}
