import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ActionButton } from "@/components/action-feedback";
import { ClientRegister } from "@/components/client-register";
import { clients } from "@/lib/demo-data";

export const metadata = { title: "Clients" };
export default function ClientsPage() { return <main className="page"><PageHeader title="Clients" description="A complete register of the people and organisations your practice works with." actions={<ActionButton className="button button-primary" message="Client creation flow opened"><Plus size={15} />New client</ActionButton>} /><ClientRegister clients={clients} /></main>; }
