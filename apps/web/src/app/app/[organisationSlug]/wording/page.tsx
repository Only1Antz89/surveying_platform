import { defaultTemplate } from "@surveynt/assistant";
import { canApproveWording } from "@surveynt/domain";
import { PageHeader } from "@/components/page-header";
import { WordingLibrary, type LibraryClause } from "@/components/wording-library";
import { requireFirmAccess } from "@/lib/access";
import { demoClauses } from "@/lib/demo-wording";
import { canAuthorWording, listWording } from "@/lib/wording";

export const metadata = { title: "Wording library" };
export const dynamic = "force-dynamic";

export default async function WordingPage({ params }: PageProps<"/app/[organisationSlug]/wording">) {
  const { organisationSlug } = await params;
  const access = await requireFirmAccess(organisationSlug);
  const demo = access.userId === "demo_user";
  const clauses = (demo ? demoClauses : await listWording(access)) as LibraryClause[];
  const elements = defaultTemplate.sections.flatMap((section) => section.elements.map((element) => ({ key: `${section.key}.${element.key}`, label: `${section.label}: ${element.label}` })));
  const full = access.accessLevel === "full";
  return <main className="page">
    <PageHeader title="Wording library" description="Your firm's approved report wording. Reports combine it with the surveyor's recorded findings; nothing is generated." />
    <WordingLibrary clauses={clauses} elements={elements} canAuthor={full && canAuthorWording(access.userRole)} canApprove={full && canApproveWording(access.userRole)} demo={demo} />
  </main>;
}
