import type { OrganisationRole, PlatformRole } from "@surveynt/domain";
import { workspaceRoute } from "./workspace-mode";

export const survaiPages = ["overview", "jobs", "job", "survey", "properties", "property", "customers", "customer", "quotes", "enquiries", "calendar", "availability", "routes", "fieldwork", "reports", "documents", "team", "finance", "performance", "settings", "billing", "governance", "services", "locations", "account", "platform-practices", "platform-billing", "platform-support", "platform-intelligence", "platform-audit", "support-session", "client-case"] as const;
export type SurvaiPage = typeof survaiPages[number];
export type SurvaiPageContext = { page: SurvaiPage; resourceId?: string };
export type SurvaiAction = { label: string; question: string; kind: "schedule" | "review" | "next" };
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const surveyorPages: SurvaiPage[] = ["overview", "jobs", "job", "survey", "properties", "property", "customers", "customer", "calendar", "availability", "routes", "reports", "documents", "account"];
const managerPages: SurvaiPage[] = [...surveyorPages, "quotes", "enquiries", "fieldwork", "team", "finance", "performance", "settings", "governance"];
const administrationPages: SurvaiPage[] = [...managerPages, "billing", "services", "locations"];
export function canUseSurvaiPage(page: SurvaiPage, role?: OrganisationRole): boolean {
 return role === "owner" ? administrationPages.includes(page) : role === "administrator" ? administrationPages.includes(page) && page !== "billing" : role === "manager" ? managerPages.includes(page) : role === "surveyor" ? surveyorPages.includes(page) : false;
}
export function canUsePlatformSurvaiPage(page: SurvaiPage, role?: PlatformRole): boolean {
 if (!role) return false;
 if (page === "platform-practices") return true;
 if (page === "platform-billing") return role === "super_admin" || role === "billing";
 if (page === "support-session") return true;
 if (page === "platform-support") return role === "super_admin" || role === "support";
 if (page === "platform-audit") return ["super_admin", "compliance", "privacy_reviewer", "technical_reviewer", "release_manager"].includes(role);
 if (page === "platform-intelligence") return ["super_admin", "compliance", "privacy_reviewer", "technical_reviewer", "release_manager"].includes(role);
 return false;
}
export function survaiPageFromPath(pathname: string, mode: "firm" | "platform" | "case", view?: string | null): SurvaiPageContext {
 if (mode === "case") return { page: "client-case" };
 const parts = workspaceRoute(pathname).canonical.split("/").filter(Boolean);
 if (mode === "platform") {
  const section = parts[1];
  return { page: section === "support" && parts[2] ? "support-session" : section === "billing" || section === "usage" ? "platform-billing" : section === "support" || section === "incidents" ? "platform-support" : section === "audit" ? "platform-audit" : ["data-sources", "practice-packs", "assistant", "learning", "settings"].includes(section) ? "platform-intelligence" : "platform-practices" };
 }
 let section = parts[2] ?? "overview", resource = parts[3];
 if (section === "workspace-instances") { section = parts[4] ?? "overview"; resource = parts[5]; }
 const resourceId = resource && uuid.test(resource) ? resource : undefined;
 if (section === "jobs") return { page: resource ? pathname.endsWith("/survey") ? "survey" : "job" : "jobs", ...(resourceId ? { resourceId } : {}) };
 if (section === "properties") return { page: resource ? "property" : "properties", ...(resourceId ? { resourceId } : {}) };
 if (section === "customers" || section === "clients") return { page: resource ? "customer" : view === "quotes" ? "quotes" : view === "enquiries" ? "enquiries" : "customers", ...(resourceId ? { resourceId } : {}) };
 if (section === "calendar") return { page: view === "availability" ? "availability" : "calendar" };
 if (section === "settings") return { page: resource === "billing" ? "billing" : resource === "ai" || resource === "learning" ? "governance" : "settings" };
 const aliases: Record<string, SurvaiPage> = { "report-templates": "reports", wording: "reports", staff: "team", demo: "overview" };
 return { page: aliases[section] ?? (survaiPages.includes(section as SurvaiPage) && !section.startsWith("platform-") && !["client-case", "support-session"].includes(section) ? section as SurvaiPage : "overview") };
}

type PageCopy = { title: string; description: string; actions: [string, string, string] };
const pages: Record<SurvaiPage, PageCopy> = {
 overview: { title: "Overview", description: "Review priorities and the next steps in your permitted work.", actions: ["Review my priorities", "Find cases needing attention", "Plan my next step"] },
 jobs: { title: "Jobs", description: "Review case stages, inspection preparation and outstanding work.", actions: ["Review the job pipeline", "Find preparation gaps", "Prioritise the next steps"] },
 job: { title: "Current case", description: "Work from this case’s authorised records and recorded dates.", actions: ["Prepare this inspection", "Review this case", "Find this case’s next step"] },
 survey: { title: "Survey workspace", description: "Prepare a review of this case. Your professional findings remain yours.", actions: ["Review case information", "Identify evidence gaps", "Plan my report review"] },
 properties: { title: "Properties", description: "Review property details connected to your permitted cases.", actions: ["Review property context", "Find missing property details", "Plan further checks"] },
 property: { title: "Current property", description: "Focus on this property and its permitted linked cases.", actions: ["Review this property", "Check this property’s records", "Plan this property’s next checks"] },
 customers: { title: "Customers", description: "Review customer case information within your access.", actions: ["Review customer casework", "Find customer follow-ups", "Identify missing case details"] },
 customer: { title: "Current customer", description: "Review this customer’s permitted casework.", actions: ["Review this customer’s cases", "Find this customer’s follow-ups", "Check missing customer details"] },
 quotes: { title: "Quotes", description: "Review recorded quote coverage and conversion totals.", actions: ["Review quote conversion", "Check quote evidence gaps", "Plan quote follow-ups"] },
 enquiries: { title: "Enquiries", description: "Review what the permitted records establish about new work.", actions: ["Review incoming work", "Identify enquiry information gaps", "Plan enquiry follow-ups"] },
 calendar: { title: "Calendar", description: "Review booked inspection dates and preparation for your permitted work.", actions: ["Review booked inspections", "Find scheduling overlaps", "Prepare upcoming visits"] },
 availability: { title: "Availability", description: "Review booked inspections. Personal busy periods are only available when supplied.", actions: ["Review my booked time", "Find appointment overlaps", "Identify availability gaps"] },
 routes: { title: "Route planning", description: "Use recorded visit times and addresses to plan your inspection day.", actions: ["Review my visit order", "Check visit details", "Plan my inspection day"] },
 fieldwork: { title: "Daily fieldwork", description: "Review permitted appointments and case allocations for fieldwork.", actions: ["Review scheduled fieldwork", "Find allocation gaps", "Prioritise visit preparation"] },
 reports: { title: "Reports", description: "Review recorded report stages and matters requiring human review.", actions: ["Review report progress", "Find report-stage gaps", "Plan professional review"] },
 documents: { title: "Documents", description: "Review metadata for files you may access. File contents need a supplied source.", actions: ["Review accessible documents", "Find document information gaps", "Plan document checks"] },
 team: { title: "Surveyor allocations", description: "Review recorded case allocations. Do not infer staff availability from workload alone.", actions: ["Review surveyor allocations", "Find unassigned cases", "Identify workload gaps"] },
 finance: { title: "Finance", description: "Review recorded financial totals and currency coverage.", actions: ["Summarise outstanding balances", "Review recorded receipts", "Check currency totals"] },
 performance: { title: "Reports & insights", description: "Review recorded case stages and financial totals without inventing historical trends.", actions: ["Review operational progress", "Review conversion totals", "Find reporting gaps"] },
 settings: { title: "Practice settings", description: "Review the practice information available in authorised sources.", actions: ["Review practice information", "Identify setup evidence gaps", "Plan configuration checks"] },
 billing: { title: "Practice billing", description: "Review supplied financial information; subscription details need their own source.", actions: ["Review available billing evidence", "Identify missing billing records", "Plan billing checks"] },
 governance: { title: "AI governance", description: "Review the evidence needed for governed use. Requests never approve models or findings.", actions: ["Review governance evidence", "Identify missing approvals", "Plan a governance review"] },
 services: { title: "Services", description: "Review recorded services across permitted casework.", actions: ["Review services in use", "Find service information gaps", "Plan service checks"] },
 locations: { title: "Locations & coverage", description: "Review recorded case addresses and visits; coverage policy needs supplied evidence.", actions: ["Review recorded locations", "Check visit location details", "Identify coverage evidence gaps"] },
 account: { title: "My work", description: "Review priorities in your permitted work without accessing private account credentials.", actions: ["Review my work priorities", "Find preparation gaps", "Plan my next step"] },
 "platform-practices": { title: "Practice lifecycle", description: "Review permitted platform status totals. Detailed customer records require support access.", actions: ["Review practice statuses", "Find lifecycle bottlenecks", "Plan practice follow-up"] },
 "platform-billing": { title: "Platform billing", description: "Review the available platform totals; billing details need a supplied billing source.", actions: ["Review available billing context", "Identify billing evidence gaps", "Plan billing follow-up"] },
 "platform-support": { title: "Platform support", description: "Review platform context without entering private practice records.", actions: ["Review permitted support context", "Identify support evidence gaps", "Plan an authorised support review"] },
 "platform-intelligence": { title: "Standards & intelligence", description: "Review the supplied platform context. Source, model and learning settings are not inferred.", actions: ["Review available platform evidence", "Identify intelligence evidence gaps", "Plan a standards review"] },
 "platform-audit": { title: "Platform audit", description: "Review supplied platform evidence; audit events need an authorised audit source.", actions: ["Review available audit evidence", "Identify audit evidence gaps", "Plan a compliance review"] },
 "support-session": { title: "Active support session", description: "Review case summaries within this authorised, read-only support session.", actions: ["Review permitted case summaries", "Find support evidence gaps", "Plan support follow-up"] },
 "client-case": { title: "Your case", description: "Understand the case information released through your secure link.", actions: ["Understand my survey", "Review my released records", "Find my case’s next step"] },
};
export function survaiContextCopy(context: SurvaiPageContext, options: { mode: "firm" | "platform" | "case"; role?: OrganisationRole; platformRole?: PlatformRole }) {
 const allowed = options.mode === "case" ? context.page === "client-case" : options.mode === "platform" ? canUsePlatformSurvaiPage(context.page, options.platformRole) : canUseSurvaiPage(context.page, options.role);
 let copy = pages[context.page];
 if(options.mode==="firm"&&context.page==="overview")copy=options.role==="surveyor"?{title:"My assigned work",description:"Review your assigned cases and prepare for your upcoming inspections.",actions:["Review my assigned jobs","Prepare upcoming visits","Plan my next step"]}:options.role==="manager"?{title:"Manager overview",description:"Review team case allocations and the practice’s operational priorities.",actions:["Review team workload","Find unassigned cases","Prioritise practice follow-ups"]}:{title:"Administration",description:"Review practice-wide casework and operational information within your access.",actions:["Review practice workload","Find operational gaps","Plan practice priorities"]};
 if(options.mode==="firm"&&context.page==="calendar")copy=options.role==="surveyor"?{...copy,actions:["Review my inspections","Check my schedule","Prepare my next visit"]}:{...copy,actions:["Review team inspections","Find scheduling overlaps","Prioritise visit preparation"]};
 const scope = options.mode === "case" ? "Use only records released for my secure client case." : options.mode === "platform" ? context.page === "support-session" ? "Use only records in this active read-only support session." : "Use only supplied platform sources; do not access private practice records." : options.role === "surveyor" ? "Use only my assigned cases and records permitted in the Surveyor workspace; do not include practice finance or other surveyors’ private records." : "Use only authorised records for this practice and my effective workspace role.";
 const actions: SurvaiAction[] = allowed ? copy.actions.map((label, index) => ({ label, kind: index === 0 ? "schedule" : index === 1 ? "review" : "next", question: `${label}. Focus on the ${copy.title.toLowerCase()} page${context.resourceId ? " and the selected record" : ""}. ${scope} Cite your sources, state missing information explicitly, and do not change records or make professional findings.` })) : [];
 return { ...copy, allowed, actions, description: allowed ? copy.description : "SurvAI requests for this page are unavailable within your current role. Switch to a permitted workspace or page." };
}

/** Called with the authenticated effective role, never a role from the request body. */
export function survaiContextError(context: SurvaiPageContext | undefined, access: { mode: "firm" | "platform" | "case" | "support"; role?: OrganisationRole; platformRole?: PlatformRole; jobId?: string; demo?: boolean }): { status: 403 | 422; message: string } | null {
 if (!context) return null;
 const allowed = access.mode === "case" ? context.page === "client-case" : access.mode === "support" ? context.page === "support-session" : access.mode === "platform" ? context.page !== "support-session" && canUsePlatformSurvaiPage(context.page, access.platformRole) : canUseSurvaiPage(context.page, access.role);
 if (!allowed) return { status: 403, message: "This SurvAI page context is not available within your current access." };
 if (access.demo) return null;
 if (["job", "survey"].includes(context.page) && (!access.jobId || context.resourceId && context.resourceId !== access.jobId)) return { status: 422, message: "Select the current case before requesting case-specific assistance." };
 if (["property", "customer"].includes(context.page) && !context.resourceId) return { status: 422, message: "Select the current record before requesting record-specific assistance." };
 if (access.jobId && !["job", "survey"].includes(context.page)) return { status: 422, message: "The selected case does not match this page context." };
 return null;
}
