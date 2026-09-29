export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ status: "ok", service: "fieldnote-web", mode: process.env.DATABASE_URL ? "connected" : "demo", timestamp: new Date().toISOString() });
}
