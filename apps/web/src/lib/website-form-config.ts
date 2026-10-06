import { z } from "zod";

export const formPaths = ["residential", "commercial", "land"] as const;
export const optionalQuestions = ["alterations", "concerns", "phone"] as const;
export const brandColours = ["#1d4ed8", "#1e40af", "#0f172a"] as const;
const safeUrl = z.string().max(500).refine(value => !value || (() => { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } })(), "Use an HTTPS URL.");
export const approvedOrigin = z.string().max(250).refine(value => { try { const u = new URL(value); return !u.hostname.includes("*") && u.origin === value && (u.protocol === "https:" || (process.env.NODE_ENV !== "production" && u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))); } catch { return false; } }, "Enter an exact HTTPS origin, without a path or wildcard.");
export const websiteFormSchema = z.object({
  enabled: z.boolean(), enquiriesEnabled: z.boolean(), approvedOrigins: z.array(approvedOrigin).max(20),
  displayName: z.string().trim().min(1).max(120), logoUrl: safeUrl, accentColour: z.enum(brandColours),
  heading: z.string().trim().min(1).max(120), introduction: z.string().trim().min(1).max(600),
  helpText: z.string().trim().max(400), buttonLabel: z.string().trim().min(1).max(60),
  contactEmail: z.union([z.email(), z.literal("")]), contactPhone: z.string().max(40), privacyUrl: safeUrl,
  paths: z.array(z.enum(formPaths)).min(1).max(3), questions: z.array(z.enum(optionalQuestions)).max(3),
  showArtwork: z.boolean(), density: z.enum(["compact", "comfortable"]), serviceIds: z.array(z.uuid()).max(100),
}).strict().refine(c => new Set(c.paths).size === c.paths.length && new Set(c.questions).size === c.questions.length && new Set(c.serviceIds).size === c.serviceIds.length && new Set(c.approvedOrigins).size === c.approvedOrigins.length, "Remove duplicate entries.");
export type WebsiteFormConfig = z.infer<typeof websiteFormSchema>;
export function defaultWebsiteForm(displayName = "Your surveying practice"): WebsiteFormConfig {
  return { enabled: false, enquiriesEnabled: false, approvedOrigins: [], displayName, logoUrl: "", accentColour: "#1d4ed8", heading: "Find the right survey", introduction: "Tell us about the property and what you need. We will explain the recommended service and next steps.", helpText: "Not sure? Choose Unknown. Your surveyor will review your answers.", buttonLabel: "Get my recommendation", contactEmail: "", contactPhone: "", privacyUrl: "", paths: [...formPaths], questions: [...optionalQuestions], showArtwork: true, density: "comfortable", serviceIds: [] };
}
export function publicationWarnings(config: WebsiteFormConfig) {
  return [!config.privacyUrl && "Add the firm's privacy notice before publishing.", !config.contactEmail && !config.contactPhone && "Add a contact email or telephone number for unavailable-service fallbacks.", config.enabled && !config.approvedOrigins.length && "Add at least one approved website origin before enabling the embed."].filter(Boolean) as string[];
}
export type FormService = { id: string; name: string; currency: string; baseAmountMinor: number; vatBasisPoints: number; depositBasisPoints: number; surcharges: Record<string, { label: string; amountMinor: number }>; validityDays: number; adviser: boolean; description: string | null };
export type FormContext = { config: WebsiteFormConfig; versionId: string | null; slug: string; services: FormService[]; quotesReady: boolean; demo: boolean };
export function publicFormConfig(config: WebsiteFormConfig) { const { approvedOrigins, ...publicConfig } = config; void approvedOrigins; return { ...publicConfig, approvedOrigins: [] }; }
export const propertyAddressSchema = z.object({ line1: z.string().trim().min(1).max(200), line2: z.string().trim().max(200), city: z.string().trim().min(1).max(100), postcode: z.string().trim().min(3).max(12), country: z.enum(["ENG", "WLS", "SCT", "NIR"]) }).strict();
export const formAnswersSchema = z.object({ path: z.enum(formPaths), purpose: z.enum(["condition-survey", "survey-and-valuation", "formal-valuation", "roof-only", "bespoke"]), propertyType: z.string().trim().min(1).max(100), propertyAge: z.enum(["pre-1950", "1950-1989", "post-1990", "listed-historic", "unknown"]), alterationTypes: z.array(z.enum(["loft-conversion", "single-storey-extension", "double-storey-extension", "conservatory"])).max(4), concerns: z.string().trim().max(2000) }).strict();
export const formSubmissionSchema = z.object({ organisationSlug: z.string().regex(/^[a-z0-9-]{2,80}$/), versionId: z.uuid(), requestId: z.uuid(), firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), email: z.email(), phone: z.string().trim().max(40), address: propertyAddressSchema, answers: formAnswersSchema, serviceId: z.uuid().optional(), privacyAcknowledged: z.literal(true), website: z.string().max(200).default("") }).strict();
export type FormSubmission = z.infer<typeof formSubmissionSchema>;
export function normaliseFormAnswers(answers: FormSubmission["answers"]) {
  const type = /flat|apartment|maisonette/i.test(answers.propertyType) ? "flat" : /bungalow/i.test(answers.propertyType) ? "bungalow" : "house";
  return { ...answers, reportedPropertyType: answers.propertyType, propertyType: type, extensions: answers.alterationTypes.length > 0 };
}
