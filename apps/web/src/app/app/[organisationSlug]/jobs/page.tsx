import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ActionButton } from "@/components/action-feedback";
import { JobsRegister } from "@/components/jobs-register";
import { loadJobs } from "@/lib/data";

export const metadata = { title: "Jobs" };
export default async function JobsPage({ params }: { params: Promise<{ organisationSlug: string }> }) { const { organisationSlug } = await params; const jobs = await loadJobs(organisationSlug); return <main className="page"><PageHeader title="Jobs" description="Move work from initial enquiry through inspection, professional review and issue." actions={<ActionButton className="button button-primary" message="Job creation flow opened"><Plus size={15} />New job</ActionButton>} /><JobsRegister jobs={jobs} /></main>; }
