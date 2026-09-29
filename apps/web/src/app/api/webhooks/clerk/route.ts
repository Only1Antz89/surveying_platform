import { createHash } from "node:crypto";
import { Webhook } from "svix";
import { z } from "zod";
import { createDatabase, organisations, platformStaff, users, webhookEvents } from "@fieldnote/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

const eventSchema = z.object({ type: z.string(), data: z.record(z.string(), z.unknown()), object: z.string().optional() });

function isBootstrapSuperAdmin(email: string) {
  const configured = process.env.PLATFORM_SUPER_ADMIN_EMAILS ?? "";
  const allowed = configured.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

export async function POST(request: Request) {
  if (!process.env.CLERK_WEBHOOK_SECRET || !process.env.DATABASE_ADMIN_URL) return Response.json({ error: "Webhook infrastructure is not configured." }, { status: 503 });
  const payload = await request.text();
  const headers = { "svix-id": request.headers.get("svix-id") ?? "", "svix-timestamp": request.headers.get("svix-timestamp") ?? "", "svix-signature": request.headers.get("svix-signature") ?? "" };
  let verified: unknown;
  try { verified = new Webhook(process.env.CLERK_WEBHOOK_SECRET).verify(payload, headers); }
  catch { return Response.json({ error: "Invalid Clerk signature." }, { status: 400 }); }
  const parsed = eventSchema.safeParse(verified);
  if (!parsed.success) return Response.json({ error: "Invalid Clerk event." }, { status: 400 });
  const db = createDatabase(process.env.DATABASE_ADMIN_URL);
  const eventId = headers["svix-id"];
  const [claim] = await db.insert(webhookEvents).values({ provider: "clerk", providerEventId: eventId, eventType: parsed.data.type, payloadHash: createHash("sha256").update(payload).digest("hex") }).onConflictDoNothing().returning({ id: webhookEvents.id });
  if (!claim) return Response.json({ received: true, duplicate: true });
  try {
    if (parsed.data.type === "organization.created") {
      const data = z.object({ id: z.string(), name: z.string(), slug: z.string().nullable().optional() }).parse(parsed.data.data);
      await db.insert(organisations).values({ clerkOrganisationId: data.id, name: data.name, slug: data.slug ?? `practice-${data.id.slice(-8)}`, practiceType: "multi-disciplinary", region: "United Kingdom" }).onConflictDoNothing();
    }
    if (parsed.data.type === "user.created" || parsed.data.type === "user.updated") {
      const data = z.object({
        id: z.string(),
        first_name: z.string().nullable().optional(),
        last_name: z.string().nullable().optional(),
        email_addresses: z.array(z.object({
          email_address: z.string(),
          id: z.string(),
          verification: z.object({ status: z.string().nullable().optional() }).nullable().optional(),
        })).default([]),
        primary_email_address_id: z.string().nullable().optional(),
      }).parse(parsed.data.data);
      const email = data.email_addresses.find((item) => item.id === data.primary_email_address_id)?.email_address ?? data.email_addresses[0]?.email_address ?? "unknown@fieldnote.invalid";
      await db.insert(users).values({ clerkUserId: data.id, email, firstName: data.first_name, lastName: data.last_name }).onConflictDoUpdate({ target: users.clerkUserId, set: { email, firstName: data.first_name, lastName: data.last_name, updatedAt: new Date() } });
      const verifiedEmail = data.email_addresses.find((item) => item.email_address.toLowerCase() === email.toLowerCase() && item.verification?.status === "verified");
      if (verifiedEmail && isBootstrapSuperAdmin(verifiedEmail.email_address)) {
        await db.insert(platformStaff).values({ clerkUserId: data.id, role: "super_admin", active: true }).onConflictDoUpdate({ target: platformStaff.clerkUserId, set: { role: "super_admin", active: true, updatedAt: new Date() } });
      }
    }
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, claim.id));
    return Response.json({ received: true });
  } catch (reason) {
    await db.update(webhookEvents).set({ failedAt: new Date(), error: reason instanceof Error ? reason.message.slice(0, 1000) : "Unknown processing error" }).where(eq(webhookEvents.id, claim.id));
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
