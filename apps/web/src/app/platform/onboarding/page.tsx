import { ClipboardCheck } from "lucide-react";
import { OperationsPage, onboardingRows } from "@/components/operations-page";
export const metadata = { title: "Onboarding" };
export default function Page() { return <OperationsPage title="Onboarding" description="Resolve stalled account creation and help firms reach their first successful job." icon={ClipboardCheck} rows={onboardingRows} />; }
