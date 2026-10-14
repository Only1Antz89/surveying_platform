import { portalProgress, type PortalView } from "./client-portal-model";

const daysAgo = (days: number, hour = 10) => { const date = new Date(Date.now() - days * 86_400_000); date.setUTCHours(hour, 0, 0, 0); return date.toISOString(); };

/** A fictional client portal for the stakeholder demonstration. Images are illustrations, labelled as such. */
export function demoPortalView(): PortalView {
  return {
    demo: true,
    brand: { name: "North Star Surveying", logoUrl: null, accent: "#2f5fc4", email: "hello@northstar.example", phone: "0117 496 0000", address: "4 Harbour Walk, Bristol BS1 5XX" },
    job: { reference: "SVJ-1048", service: "Level 3 Building Survey", stage: "report_drafting" },
    property: { address: "18 Royal York Crescent, Clifton, Bristol, BS8 4JX", propertyType: "Terraced house" },
    progress: portalProgress("report_drafting", [
      { toStage: "instructed", at: daysAgo(12) }, { toStage: "scheduled", at: daysAgo(11) }, { toStage: "inspection_complete", at: daysAgo(4, 15) }, { toStage: "report_drafting", at: daysAgo(3) },
    ]),
    appointment: { startsAt: daysAgo(4, 9), endsAt: daysAgo(4, 13), status: "confirmed" },
    timezone: "Europe/London",
    documents: [
      { key: "rics_report", kind: "report", title: "RICS survey report", description: "Your report in the RICS format, as signed off by your surveyor.", available: false, reason: "Available once the report is issued." },
      { key: "practice_report", kind: "report", title: "North Star Surveying report", description: "The same findings in the practice's own layout, including room measurements.", available: false, reason: "Available once the report is issued." },
      { key: "signed_terms", kind: "contract", title: "Signed terms of engagement", description: "Version 3, signed by Elizabeth Harrington.", available: true, reason: null },
      { key: "quote", kind: "quote", title: "Your quote", description: "The fee and service you accepted.", available: true, reason: null },
    ],
    invoices: [
      { id: "00000000-0000-4000-8000-000000000101", number: "INV-2041", status: "paid", currency: "GBP", totalMinor: 29000, issuedAt: daysAgo(12), dueAt: daysAgo(12) },
      { id: "00000000-0000-4000-8000-000000000102", number: "INV-2057", status: "open", currency: "GBP", totalMinor: 145000, issuedAt: daysAgo(3), dueAt: daysAgo(-11) },
    ],
    files: [
      { id: "demo-photo-1", category: "photo", title: "Street elevation", contentType: "image/webp", sharedAt: daysAgo(4, 16), previewSrc: "/property-artwork/terraced-row.webp" },
      { id: "demo-photo-2", category: "photo", title: "Rear and garden wall", contentType: "image/webp", sharedAt: daysAgo(4, 16), previewSrc: "/property-artwork/cottage.webp" },
      { id: "demo-cert-1", category: "certificate", title: "Gas safety record (2026)", contentType: "application/pdf", sharedAt: daysAgo(3, 11) },
      { id: "demo-cert-2", category: "certificate", title: "Electrical installation condition report", contentType: "application/pdf", sharedAt: daysAgo(3, 11) },
    ],
    information: [
      { label: "Energy rating", value: "Current D (58), potential B (81)", source: "EPC register · Open Government Licence v3.0", retrievedAt: daysAgo(10) },
      { label: "Listed building", value: "Grade II listed (fictional entry)", source: "Historic England · demonstration", retrievedAt: daysAgo(10) },
      { label: "Flood risk", value: "Very low risk from rivers and the sea", source: "Environment Agency · demonstration", retrievedAt: daysAgo(10) },
    ],
    terms: { required: true, signed: true, version: 3, signedAt: daysAgo(12, 9), signedBy: "Elizabeth Harrington" },
    quoteLink: false,
    reportAccessExpiresAt: null,
  };
}

/** Fictional practice-side portal state for the demo job record. */
export function demoPortalAdmin(jobId: string) {
  return {
    clientEmail: "elizabeth.harrington@example.test", clientName: "Elizabeth Harrington", hasQuote: jobId === "job_01", canManage: true,
    access: jobId === "job_01" ? { id: "demo", email: "elizabeth.harrington@example.test", source: "quote_accepted", lastSentAt: daysAgo(12), lastViewedAt: daysAgo(1, 19), expiresAt: daysAgo(-500), createdAt: daysAgo(12) } : null,
    shared: jobId === "job_01" ? [{ id: "demo-photo-1", mediaAssetId: "media-1", category: "photo", title: "Front elevation", sharedAt: daysAgo(4, 16) }, { id: "demo-cert-1", mediaAssetId: "media-3", category: "certificate", title: "Gas safety record (2026)", sharedAt: daysAgo(3, 11) }] : [],
    media: [
      { id: "media-1", kind: "photo", name: "IMG_2041.jpg", contentType: "image/jpeg", capturedAt: daysAgo(4, 10), element: "main_walls" },
      { id: "media-2", kind: "photo", name: "IMG_2052.jpg", contentType: "image/jpeg", capturedAt: daysAgo(4, 11), element: "roof_coverings" },
      { id: "media-3", kind: "document", name: "gas-safety-2026.pdf", contentType: "application/pdf", capturedAt: daysAgo(3, 11), element: null },
    ],
  };
}
