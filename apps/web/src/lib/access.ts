import { auth } from "@clerk/nextjs/server";
import { createDatabase, organisations, platformStaff } from "@fieldnote/db";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

export const isClerkConfigured = () => Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
const isDatabaseConfigured = () => Boolean(process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL);

export async function requireFirmAccess(slug: string) {
  if (!isClerkConfigured()) return { userId: "demo_user", clerkOrganisationId: "demo_org", organisationId: "00000000-0000-0000-0000-000000000001" };
  const session = await auth();
  if (!session.userId) redirect("/sign-in");
  if (!session.orgId) redirect("/start");
  if (!isDatabaseConfigured()) throw new Error("DATABASE_APP_URL or DATABASE_URL is required when Clerk is enabled");
  const db = createDatabase();
  const [organisation] = await db.select({ id: organisations.id, clerkOrganisationId: organisations.clerkOrganisationId, slug: organisations.slug }).from(organisations).where(eq(organisations.clerkOrganisationId, session.orgId)).limit(1);
  if (!organisation) notFound();
  if (organisation.slug !== slug) redirect(`/app/${organisation.slug}/overview`);
  return { userId: session.userId, clerkOrganisationId: session.orgId, organisationId: organisation.id };
}

export async function requirePlatformAccess() {
  if (!isClerkConfigured()) return { userId: "demo_platform_user", role: "super_admin" as const };
  const session = await auth();
  if (!session.userId) redirect("/sign-in");
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required for platform administration");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [operator] = await db.select({ role: platformStaff.role }).from(platformStaff).where(and(eq(platformStaff.clerkUserId, session.userId), eq(platformStaff.active, true))).limit(1);
  if (!operator) notFound();
  return { userId: session.userId, role: operator.role };
}

export async function apiContext(request: Request) {
  if (!isClerkConfigured()) {
    return { userId: "demo_user", clerkOrganisationId: "demo_org", organisationId: "00000000-0000-0000-0000-000000000001", demo: true };
  }
  const session = await auth();
  if (!session.userId || !session.orgId) return null;
  if (!isDatabaseConfigured()) throw new Error("DATABASE_APP_URL or DATABASE_URL is required when Clerk is enabled");
  const db = createDatabase();
  const [organisation] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.clerkOrganisationId, session.orgId)).limit(1);
  if (!organisation) return null;
  void request;
  return { userId: session.userId, clerkOrganisationId: session.orgId, organisationId: organisation.id, demo: false };
}
