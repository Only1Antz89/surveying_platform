import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { createDatabase, platformStaff, organisations } from "@surveynt/db";
import { redirect } from "next/navigation";
import { isClerkConfigured } from "@/lib/access";
export default async function Home() {
  if (!isClerkConfigured()) redirect("/app/clifton-surveyors/overview");
  const session = await auth();
  if (!session.userId) redirect("/sign-in");
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const [staff] = await db
    .select({ id: platformStaff.id })
    .from(platformStaff)
    .where(
      and(
        eq(platformStaff.clerkUserId, session.userId),
        eq(platformStaff.active, true),
      ),
    )
    .limit(1);
  if (staff) redirect("/platform/tenants");
  if (session.orgId) {
    const [org] = await db
      .select({ slug: organisations.slug })
      .from(organisations)
      .where(eq(organisations.clerkOrganisationId, session.orgId))
      .limit(1);
    if (org) redirect(`/app/${org.slug}/overview`);
  }
  redirect("/start");
}
