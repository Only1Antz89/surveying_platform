import { PageHeader } from "@/components/page-header";
import { JobsRegister } from "@/components/jobs-register";
import { loadJobFormOptions, loadJobs } from "@/lib/data";
import { canMutateOperations } from "@surveynt/domain";
import { requireFirmAccess } from "@/lib/access";

export const metadata = { title: "Jobs" };
export default async function JobsPage({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  const [jobs, options, access] = await Promise.all([loadJobs(organisationSlug), loadJobFormOptions(organisationSlug), requireFirmAccess(organisationSlug)]);
  return <main className="page"><PageHeader title="Jobs" description="Move work from initial enquiry through inspection, professional review and issue." /><JobsRegister slug={organisationSlug} jobs={jobs} options={options} canEdit={access.accessLevel === "full" && canMutateOperations(access.userRole)} /></main>;
}
