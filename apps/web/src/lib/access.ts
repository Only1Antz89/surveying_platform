import { auth } from "@clerk/nextjs/server";
import { resolveAccess } from "@surveynt/domain";
import { createDatabase, entitlements, organisationMemberships, organisations, platformStaff, subscriptions, users } from "@surveynt/db";
import { and, eq, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

export const isClerkConfigured = () => Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
const isDatabaseConfigured = () => Boolean(process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL);

function hasPilotExemption(organisationId: string) {
  return (process.env.BILLING_EXEMPT_ORGANISATION_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean).includes(organisationId);
}

async function requireFirmAccessUncached(slug: string) {
  if (!isClerkConfigured()) return {
    userId: "demo_user",
    internalUserId: null,
    clerkOrganisationId: "demo_org",
    organisationId: "00000000-0000-0000-0000-000000000001",
    organisationName: "North Star Surveying",
    organisationRegion: "Bristol, United Kingdom",
    userName: "Maya Patel",
    userEmail: "maya@northstarsurveying.co.uk",
    userRole: "owner" as const,
    canRecordSurvey: false,
    canApproveReports: false,
    accessLevel: "full" as const,
    trialEndsAt: new Date("2026-10-10T00:00:00.000Z"),
    isDemo: false,
  };
  const session = await auth();
  if (!session.userId) redirect("/sign-in");
  if (!session.orgId) redirect("/start");
  if (!isDatabaseConfigured()) throw new Error("DATABASE_APP_URL or DATABASE_URL is required when Clerk is enabled");
  const db = createDatabase();
  const [organisation] = await db.select({
    id: organisations.id,
    clerkOrganisationId: organisations.clerkOrganisationId,
    slug: organisations.slug,
    name: organisations.name,
    region: organisations.region,
    status: organisations.status,
    isDemo: organisations.isDemo,
  }).from(organisations).where(eq(organisations.clerkOrganisationId, session.orgId)).limit(1);
  if (!organisation) notFound();
  if (organisation.slug !== slug) redirect(`/app/${organisation.slug}/overview`);
  const details = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${organisation.id}, true)`);
    const [member] = await tx.select({
      internalUserId: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: organisationMemberships.role,
      canRecordSurvey: organisationMemberships.canRecordSurvey,
      canApproveReports: organisationMemberships.canApproveReports,
    }).from(organisationMemberships)
      .innerJoin(users, eq(organisationMemberships.userId, users.id))
      .where(and(
        eq(organisationMemberships.organisationId, organisation.id),
        eq(organisationMemberships.active, true),
        eq(users.clerkUserId, session.userId),
      )).limit(1);
    const [subscription] = await tx.select({ status: subscriptions.status, trialEndsAt: subscriptions.trialEndsAt, graceEndsAt: subscriptions.graceEndsAt })
      .from(subscriptions)
      .where(eq(subscriptions.organisationId, organisation.id))
      .limit(1);
    const [billingExemption] = await tx.select({ enabled: entitlements.enabled }).from(entitlements).where(and(eq(entitlements.organisationId, organisation.id), eq(entitlements.key, "billing_exempt"), eq(entitlements.enabled, true))).limit(1);
    return { member, subscription, billingExemption };
  });
  if (!details.member) notFound();
  const userName = [details.member.firstName, details.member.lastName].filter(Boolean).join(" ") || details.member.email;
  const accessLevel = organisation.status === "active" && (details.billingExemption?.enabled || hasPilotExemption(organisation.id))
    ? "full" as const
    : resolveAccess(organisation.status, details.subscription?.status ?? "incomplete", details.subscription?.graceEndsAt);
  return {
    userId: session.userId,
    internalUserId: details.member.internalUserId,
    clerkOrganisationId: session.orgId,
    organisationId: organisation.id,
    organisationName: organisation.name,
    organisationRegion: organisation.region,
    userName,
    userEmail: details.member.email,
    userRole: details.member.role,
    canRecordSurvey: details.member.canRecordSurvey,
    canApproveReports: details.member.canApproveReports,
    accessLevel,
    trialEndsAt: details.subscription?.trialEndsAt ?? null,
    isDemo: organisation.isDemo,
  };
}

export const requireFirmAccess = cache(requireFirmAccessUncached);

export function canWriteWorkspace(context: { accessLevel: "full" | "billing_only" | "read_only" | "blocked" }) {
  return context.accessLevel === "full";
}

export async function requirePlatformAccess() {
  if (!isClerkConfigured()) return { userId: "demo_platform_user", platformStaffId: "00000000-0000-0000-0000-000000000001", userName: "Surveynt Operator", userEmail: "operator@surveynt.local", role: "super_admin" as const };
  const session = await auth();
  if (!session.userId) redirect("/sign-in");
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for platform administration");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [operator] = await db.select({ id: platformStaff.id, role: platformStaff.role, email: users.email, firstName: users.firstName, lastName: users.lastName }).from(platformStaff).leftJoin(users, eq(users.clerkUserId, platformStaff.clerkUserId)).where(and(eq(platformStaff.clerkUserId, session.userId), eq(platformStaff.active, true))).limit(1);
  if (!operator) notFound();
  const userEmail = operator.email ?? "platform-operator@surveynt.local";
  const userName = [operator.firstName, operator.lastName].filter(Boolean).join(" ") || userEmail;
  return { userId: session.userId, platformStaffId: operator.id, userName, userEmail, role: operator.role };
}

export async function platformApiContext() {
  if (!isClerkConfigured()) return { userId: "demo_platform_user", platformStaffId: "00000000-0000-0000-0000-000000000001", role: "super_admin" as const, demo: true };
  const session = await auth();
  if (!session.userId || !process.env.DATABASE_ADMIN_URL) return null;
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [operator] = await db.select({ id: platformStaff.id, role: platformStaff.role }).from(platformStaff).where(and(eq(platformStaff.clerkUserId, session.userId), eq(platformStaff.active, true))).limit(1);
  if (!operator) return null;
  return { userId: session.userId, platformStaffId: operator.id, role: operator.role, demo: false };
}

export async function apiContext(request: Request) {
  if (!isClerkConfigured()) {
    return { userId: "demo_user", internalUserId: null, clerkOrganisationId: "demo_org", organisationId: "00000000-0000-0000-0000-000000000001", role: "owner" as const, canRecordSurvey: false, canApproveReports: false, accessLevel: "full" as const, demo: true };
  }
  const session = await auth();
  if (!session.userId || !session.orgId) return null;
  if (!isDatabaseConfigured()) throw new Error("DATABASE_APP_URL or DATABASE_URL is required when Clerk is enabled");
  const db = createDatabase();
  const [organisation] = await db.select({ id: organisations.id, status: organisations.status }).from(organisations).where(eq(organisations.clerkOrganisationId, session.orgId)).limit(1);
  if (!organisation) return null;
  const details = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organisation_id', ${organisation.id}, true)`);
    const [member] = await tx.select({ internalUserId: users.id, role: organisationMemberships.role, canRecordSurvey: organisationMemberships.canRecordSurvey, canApproveReports: organisationMemberships.canApproveReports })
      .from(organisationMemberships)
      .innerJoin(users, eq(organisationMemberships.userId, users.id))
      .where(and(
        eq(organisationMemberships.organisationId, organisation.id),
        eq(organisationMemberships.active, true),
        eq(users.clerkUserId, session.userId),
      )).limit(1);
    const [subscription] = await tx.select({ status: subscriptions.status, graceEndsAt: subscriptions.graceEndsAt }).from(subscriptions).where(eq(subscriptions.organisationId, organisation.id)).limit(1);
    const [billingExemption] = await tx.select({ enabled: entitlements.enabled }).from(entitlements).where(and(eq(entitlements.organisationId, organisation.id), eq(entitlements.key, "billing_exempt"), eq(entitlements.enabled, true))).limit(1);
    return { member, subscription, billingExemption };
  });
  if (!details.member) return null;
  const accessLevel = organisation.status === "active" && (details.billingExemption?.enabled || hasPilotExemption(organisation.id))
    ? "full" as const
    : resolveAccess(organisation.status, details.subscription?.status ?? "incomplete", details.subscription?.graceEndsAt);
  void request;
  return { userId: session.userId, internalUserId: details.member.internalUserId, clerkOrganisationId: session.orgId, organisationId: organisation.id, role: details.member.role, canRecordSurvey: details.member.canRecordSurvey, canApproveReports: details.member.canApproveReports, accessLevel, demo: false };
}
