import { CustomerQuotePortal } from "@/components/customer-quote-portal";
export const metadata = { title: "Your survey quote" };
export default async function Page({ params }: PageProps<"/quote/[id]">) { const { id } = await params; return <CustomerQuotePortal id={id} />; }
