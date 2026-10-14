import type { Acceptance, TermsVersion } from "./engagement-terms";

const body = `1. The service
We will carry out the survey described in your quote, following the practice's published service description.

2. Access and limitations
We inspect what is visible and reasonably accessible on the day. We do not move heavy furniture, lift fixed floor coverings or open up the structure.

3. Fees and payment
The deposit secures your appointment. The balance is due before the report is released.

4. Cancellation
You may cancel without charge up to 48 hours before the visit.

5. Complaints
Our complaints handling procedure is available on request.`;

/** Fictional practice terms used in the local preview. */
export const demoTerms: { required: boolean; versions: TermsVersion[] } = {
  required: true,
  versions: [
    { id: "demo-terms-3", version: 3, title: "Terms of engagement for residential surveys", body, status: "published", publishedAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z" },
    { id: "demo-terms-2", version: 2, title: "Terms of engagement for residential surveys", body, status: "retired", publishedAt: "2026-03-01T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z" },
  ],
};

export function demoJobEngagement(jobId: string): { required: boolean; current: { id: string; version: number; title: string }; acceptance: Acceptance | null } {
  const signed = jobId === "job_01" || jobId === "job_03";
  return { required: true, current: { id: "demo-terms-3", version: 3, title: demoTerms.versions[0].title }, acceptance: signed ? { id: `acc-${jobId}`, termsId: "demo-terms-3", version: 3, signerName: jobId === "job_01" ? "Elizabeth Harrington" : "Daniel Okafor", signerEmail: null, method: "typed_signature", signedAt: "2026-10-02T10:14:00.000Z", termsSha256: "demo" } : null };
}
