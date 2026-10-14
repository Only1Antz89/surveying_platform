import type { Metadata } from "next";
import { ClientPortal } from "@/components/client-portal";

export const metadata: Metadata = { title: "Your client portal", robots: { index: false, follow: false }, referrer: "no-referrer" };

// The shell carries no case data; the portal loads it with the secure code from the link.
export default async function Page({ params }: PageProps<"/portal/[id]">) {
  const { id } = await params;
  return <ClientPortal id={id} />;
}
