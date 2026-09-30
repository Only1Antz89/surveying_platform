import { BookOpenCheck } from "lucide-react";
import { OperationsPage } from "@/components/operations-page";
import { loadPlatformPracticePackQueue } from "@/lib/data";
export const metadata = { title: "Practice packs" };
export default async function Page() { const rows = await loadPlatformPracticePackQueue(); return <OperationsPage title="Practice packs" description="Inspect the versioned surveying workflows firms can enable in their workspace." icon={BookOpenCheck} rows={rows} emptyMessage="No practice packs have been configured." />; }
