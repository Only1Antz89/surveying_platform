import { canMutateOperations } from "@surveynt/domain";
import { apiContext } from "@/lib/access";
import { invalidId, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { BrandedDocument, longDate, pdfResponse } from "@/lib/branded-pdf";
import { jobLetterPdf, letterInput } from "@/lib/practice-documents";
import { jobs } from "@/lib/demo-data";
export const runtime = "nodejs";

/** Produces a letter to the job's client on practice letterhead. Nothing is sent or stored. */
export async function POST(request: Request, route: RouteContext<"/api/v1/jobs/[id]/letters">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.accessLevel !== "full" || !canMutateOperations(context.role)) return problem(403, "forbidden", "Letters need an active workspace and operational access.");
  const parsed = await parseBody(request, letterInput);
  if (!parsed.success) return problem(422, "invalid_letter", "Add a subject and the letter text.");
  const { id } = await route.params;
  if (context.demo) {
    const job = jobs.find((item) => item.id === id);
    if (!job) return problem(404, "not_found", "The job could not be found.");
    const pdf = await BrandedDocument.create({ name: "North Star Surveying (fictional)", accent: "#2f6fe0", address: "1 Example Street, Bristol", email: null, phone: null }, parsed.data.subject, { watermark: "PREVIEW" });
    pdf.paragraph(longDate(new Date()), { muted: true }).paragraph(job.client, { bold: true }).paragraph(`Our reference: ${job.reference}`, { muted: true }).heading(parsed.data.subject).paragraph(`Property: ${job.address}`, { muted: true });
    for (const paragraph of parsed.data.body.split(/\n{2,}/)) pdf.paragraph(paragraph);
    pdf.spacer(10).paragraph("Yours sincerely,").spacer(18).paragraph("North Star Surveying", { bold: true });
    return pdfResponse(await pdf.finish(`Fictional preview · ${job.reference}`), `letter-${job.reference}.pdf`);
  }
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  const document = await jobLetterPdf(context, id, parsed.data);
  return document ? pdfResponse(document.bytes, document.filename) : problem(404, "not_found", "The job could not be found.");
}
