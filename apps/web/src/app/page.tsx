import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createDatabase, organisations } from "@surveynt/db";
import { eq } from "drizzle-orm";
import { isClerkConfigured } from "@/lib/access";

/** Sends each visitor straight to the right place: their own practice, setup, or sign-in. */
export default async function Home() {
  if (!isClerkConfigured()) redirect("/app/demo/overview");
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/start");
  const [organisation] = await createDatabase().select({ slug: organisations.slug }).from(organisations).where(eq(organisations.clerkOrganisationId, orgId)).limit(1);
  redirect(organisation ? `/app/${organisation.slug}/overview` : "/start");
}
