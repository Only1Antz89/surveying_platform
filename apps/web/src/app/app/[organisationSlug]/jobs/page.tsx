import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ActionButton } from "@/components/action-feedback";
import { JobsRegister } from "@/components/jobs-register";
import { jobs } from "@/lib/demo-data";

export const metadata = { title: "Jobs" };
export default function JobsPage() { return <main className="page"><PageHeader title="Jobs" description="Move work from initial enquiry through inspection, professional review and issue." actions={<ActionButton className="button button-primary" message="Job creation flow opened"><Plus size={15} />New job</ActionButton>} /><JobsRegister jobs={jobs} /></main>; }
