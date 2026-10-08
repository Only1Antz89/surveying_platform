import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { PageHeader } from "@/components/page-header";
import { JobsRegister } from "@/components/jobs-register";
import { loadJobFormOptions, loadJobs } from "@/lib/data";
import { canMutateOperations } from "@surveynt/domain";
import { requireFirmAccess } from "@/lib/access";

export const metadata = { title: "Jobs" };
export default async function JobsPage({ params,searchParams }: PageProps<"/app/[organisationSlug]/jobs">) {
  const { organisationSlug } = await params; await requireWorkspacePageAccess(organisationSlug, "jobs");
  const [jobs, options, access] = await Promise.all([loadJobs(organisationSlug), loadJobFormOptions(organisationSlug), requireFirmAccess(organisationSlug)]);
  const selected=(await searchParams).job;
  return <main className="page"><PageHeader title="Jobs" description="Move work from initial enquiry through inspection, professional review and issue." /><JobsRegister slug={organisationSlug} jobs={jobs} options={options} initialSelectedId={typeof selected==="string"?selected:undefined} showFinance={access.userRole !== "surveyor"} canEdit={access.accessLevel === "full" && canMutateOperations(access.userRole) && access.userRole !== "surveyor"} /></main>;
}
