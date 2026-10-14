// Pure pieces of the client portal, shared by the server and the browser.

export const portalSteps = [
  { stage: "instructed", label: "Instruction confirmed", detail: "Your survey is booked in with the practice." },
  { stage: "scheduled", label: "Visit booked", detail: "A surveyor and appointment are confirmed." },
  { stage: "inspection_complete", label: "Inspection complete", detail: "The surveyor has visited the property." },
  { stage: "report_drafting", label: "Report being written", detail: "Findings are being written up." },
  { stage: "internal_review", label: "Quality review", detail: "A second surveyor is checking the report." },
  { stage: "issued", label: "Report issued", detail: "Your report is ready to read and download." },
  { stage: "paid", label: "Complete", detail: "Everything is settled." },
] as const;

export type PortalStep = { stage: string; label: string; detail: string; state: "done" | "current" | "upcoming"; reachedAt: string | null };

/** Steps with the first date each was reached. Earlier stages (enquiry, quoted) count as before instruction. */
export function portalProgress(stage: string, events: { toStage: string; at: Date | string }[]): PortalStep[] {
  const order: string[] = portalSteps.map((step) => step.stage);
  const effective = stage === "archived" ? "paid" : stage;
  const index = order.indexOf(effective);
  const firstReached = (target: string) => {
    const at = events.filter((event) => order.indexOf(event.toStage) >= order.indexOf(target)).map((event) => new Date(event.at).getTime()).sort((a, b) => a - b)[0];
    return at === undefined ? null : new Date(at).toISOString();
  };
  return portalSteps.map((step, position) => ({ ...step, state: index < 0 ? "upcoming" : position < index ? "done" : position === index ? (effective === "paid" ? "done" : "current") : "upcoming", reachedAt: index >= 0 && position <= index ? firstReached(step.stage) : null }));
}

/** Only well-formed hex colours from practice branding are applied to the portal. */
export const safeAccent = (value: string | null | undefined) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : null;

export type PortalDocument = { key: string; title: string; description: string; available: boolean; reason: string | null; kind: "report" | "contract" | "quote" | "invoice" };
export type PortalFile = { id: string; category: "photo" | "video" | "certificate" | "document"; title: string; contentType: string; sharedAt: string; /** Demonstration only: an illustration shown in place of a shared photo. */ previewSrc?: string };
export type PortalInvoice = { id: string; number: string; status: string; currency: string; totalMinor: number; issuedAt: string | null; dueAt: string | null };
export type PortalView = {
  brand: { name: string; logoUrl: string | null; accent: string | null; email: string | null; phone: string | null; address: string | null };
  job: { reference: string; service: string; stage: string };
  property: { address: string; propertyType: string | null };
  progress: PortalStep[];
  appointment: { startsAt: string; endsAt: string; status: string } | null;
  timezone: string;
  documents: PortalDocument[];
  invoices: PortalInvoice[];
  files: PortalFile[];
  information: { label: string; value: string; source: string; retrievedAt: string | null }[];
  terms: { required: boolean; signed: boolean; version: number | null; signedAt: string | null; signedBy: string | null };
  quoteLink: boolean;
  reportAccessExpiresAt: string | null;
  demo?: boolean;
};
