import { BookOpenCheck } from "lucide-react";
import { OperationsPage, packRows } from "@/components/operations-page";
export const metadata = { title: "Practice packs" };
export default function Page() { return <OperationsPage title="Practice packs" description="Manage the versioned surveying workflows firms can enable in their workspace." icon={BookOpenCheck} rows={packRows} />; }
