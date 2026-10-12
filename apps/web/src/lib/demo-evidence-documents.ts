import {workspaceAudit} from "@/lib/workspace-audit";
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { auditEvents, createDatabase, customerQuotes, jobs, withTenant, type Database } from "@surveynt/db";
import { makeTextPdf, makeImageOnlyPdf } from "@surveynt/evidence/testing";
import { requireDemoEvidenceOwner } from "./demo-evidence";
import { PreinspectionError, type PreinspectionStaff } from "./preinspection";
import { uploadPreinspectionDocument } from "./preinspection-documents";
import { getObjectStorage } from "./storage";
import { z } from "zod";

function fixtureRequestId(organisationId: string, jobId: string, key: string) {
  const hash = createHash("sha256").update(`${organisationId}:${jobId}:demo-document-v1:${key}`).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

/** Normal private document pipeline, behind a persisted demo and current Owner gate. */
export async function seedDemoEvidenceDocuments(context: PreinspectionStaff, quoteId: string, db: Database = createDatabase()) {
  const storage = getObjectStorage();
  const newKeys: string[] = [];
  try {
    return await withTenant(db, context.organisationId, async tx => {
      await requireDemoEvidenceOwner(tx, context);
      if (!z.uuid().safeParse(quoteId).success) throw new PreinspectionError(400, "invalid_quote", "Choose a converted demo quote.");
      const [quote] = await tx.select().from(customerQuotes).where(and(eq(customerQuotes.organisationId, context.organisationId), eq(customerQuotes.id, quoteId))).for("share").limit(1);
      if (!quote?.jobId || quote.status !== "converted") throw new PreinspectionError(404, "demo_job_unavailable", "Choose a converted quote linked to an active demo job.");
      const [job] = await tx.select().from(jobs).where(and(eq(jobs.organisationId, context.organisationId), eq(jobs.id, quote.jobId))).for("update").limit(1);
      if (!job || job.stage === "archived" || job.propertyId !== quote.propertyId) throw new PreinspectionError(404, "demo_job_unavailable", "The linked job or property is unavailable.");
      if (!storage) throw new PreinspectionError(503, "storage_not_configured", "Private document storage is required for document scenarios. Questionnaire text remains available.");
      const title = ["FICTIONAL SURVEYNT DEMO - NOT A VALID CERTIFICATE", "No real property, authority or inspection is represented."];
      const fixtures = [
        { key: "issue-only", name: "FICTIONAL-demo-issue-date-only.pdf", bytes: makeTextPdf([[...title, "Building regulations completion certificate", "Date of issue: 01/01/2021", "Certificate number: DEMO-ISSUE-ONLY", "Works completion date is not supplied."]]) },
        { key: "works-completion", name: "FICTIONAL-demo-explicit-works-completion.pdf", bytes: makeTextPdf([[...title, "Building regulations completion certificate", "Date of issue: 01/01/2021", "Works completion date: 15/06/2020", "Certificate number: DEMO-WORKS-2020", "Property and extension association requires professional review."]]) },
        { key: "blank-manual-review", name: "FICTIONAL-demo-blank-no-text-manual-review.pdf", bytes: makeImageOnlyPdf() },
      ];
      const prepared: { id: string; name: string }[] = [];
      let skipped = 0;
      for (const fixture of fixtures) {
        const form = new FormData();
        form.set("requestId", fixtureRequestId(context.organisationId, job.id, fixture.key));
        form.set("file", new File([new Uint8Array(fixture.bytes)], fixture.name, { type: "application/pdf" }));
        const stored = { key: null as string | null };
        try {
          const result = await uploadPreinspectionDocument(tx, { organisationId: context.organisationId, jobId: job.id, propertyId: job.propertyId, actorUserId: context.internalUserId, source: "staff_transcribed_client", valuation: /valuation/i.test(job.serviceName) }, new Request("http://localhost/demo-fixture", { method: "POST", body: form }), stored);
          if (result.duplicate) skipped++; else prepared.push({ id: result.id, name: fixture.name });
        } finally { if (stored.key) newKeys.push(stored.key); }
      }
      await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "demo.evidence_documents_prepared", resourceType: "job", resourceId: job.id, metadata: { prepared: prepared.length, skipped, simulated: true, automaticWorksAssociation: false } }));
      return { prepared, skipped, jobId: job.id, demo: true, message: "Fictional private documents prepared. Review them in the job questionnaire; no works association or survey answer was applied." };
    });
  } catch (error) {
    // Only objects created by this transaction are cleaned up. Existing originals remain intact.
    await Promise.all(newKeys.map(key => storage?.remove(key).catch(() => undefined)));
    throw error;
  }
}
