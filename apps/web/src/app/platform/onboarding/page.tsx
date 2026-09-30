import { ClipboardCheck } from "lucide-react";
import { OperationsPage } from "@/components/operations-page";
import { loadPlatformOnboardingQueue } from "@/lib/data";
export const metadata = { title: "Onboarding" };
export default async function Page() { const rows = await loadPlatformOnboardingQueue(); return <OperationsPage title="Onboarding" description="Resolve stalled account creation and help firms reach their first successful job." icon={ClipboardCheck} rows={rows} emptyMessage="No onboarding accounts currently require attention." />; }
