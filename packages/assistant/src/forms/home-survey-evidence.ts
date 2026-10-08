import type { FormTemplate } from "./types";

export type EvidenceMapping = { mode: "suggested_answer" | "context_only" | "manual_only"; sources: string[]; boundary: string };
const epc = ["epc_england_wales"];
const customer = ["customer_questionnaire"];
const mappings: Record<string, EvidenceMapping> = {};
function add(paths: string[], mode: EvidenceMapping["mode"], sources: string[], boundary: string) {
  for (const path of paths) mappings[path] = { mode, sources, boundary };
}
add(["a.details.weather"], "suggested_answer", ["inspection_weather"], "Historical day-wide context only. Confirm actual inspection date and observed weather.");
add(["a.details.surveyor_name", "a.details.rics_number", "declaration.details.surveyor_name", "declaration.details.rics_number"], "suggested_answer", ["practitioner_profile"], "Recording practitioner's identity only. RICS number is self-declared, not verified.");
add(["a.details.company_name", "declaration.details.company_name", "declaration.details.company_address", "declaration.details.contact_details"], "suggested_answer", ["firm_report_identity"], "Use approved report contact details, not private office or staff details.");
add(["a.details.property_address", "a.details.report_reference"], "suggested_answer", ["job_record"], "Use the current confirmed property and job record; review before applying.");
add(["a.details.inspection_date"], "suggested_answer", ["job_record"], "Scheduled date offered for confirmation, never treated as the actual visit date.");
add(["a.details.access_arrangements", "a.details.client_brief", "c.details.flat_information", "c.details.grounds", "valuation.details.agreed_price", "valuation.details.tenure", "valuation.details.tenancies"], "suggested_answer", customer, "Client statement, not a verified observation, valuation or legal right.");
add(["a.details.property_status"], "context_only", customer, "Reported occupancy is not occupancy observed during inspection.");
add(["c.details.property_type", "c.details.built_year", "c.details.accommodation"], "suggested_answer", [...epc, ...customer], "Historical certificate or client statement. Preserve approximate ranges; floor area is not surveyed or a room layout.");
add(["c.details.construction", "c.details.energy_rating", "c.details.central_heating", "energy.details.energy_efficiency", "energy.details.insulation", "energy.details.heating_energy"], "suggested_answer", epc, "Historical energy description only; preserve assumed/unknown wording. No present condition or safety claim.");
add(["c.details.energy_issues", "energy.details.further_energy_advice"], "context_only", epc, "Certificate recommendations are historical and may be unsuitable; professional advice remains manual.");
add(["d.d2.construction", "e.e1.construction"], "context_only", epc, "An EPC roof insulation description does not establish roof covering or structural construction.");
add(["d.d4.construction", "d.d5.construction", "e.e4.construction", "f.f4.construction", "f.f5.construction"], "suggested_answer", epc, "Historical description only; not a structural assessment, operational test or safety certification.");
add(["c.details.extended_year", "c.details.converted_year"], "suggested_answer", ["confirmed_completion_document", ...customer], "Only an explicitly stated completion date linked to the relevant works/property. Never use permission or certificate issue dates.");
add(["b.details.documents_requested", "h.details.regulations", "h.details.guarantees", "h.details.other_matters"], "context_only", ["document_extraction", ...customer, "planning_data", "historic_england_nhle"], "Document/enquiry prompts only; no declaration of compliance, valid guarantees or lease rights.");
add(["c.details.location"], "suggested_answer", ["postcodes_io"], "Postcode administrative geography is approximate, not a property-specific classification.");
add(["c.details.local_environment"], "suggested_answer", ["planning_data", "historic_england_nhle", "ea_flood_zones", "ne_designations"], "Designation context with coverage and matching caveats. Missing results do not establish absence.");
add(["i.details.building_risks", "i.details.grounds_risks", "i.details.people_risks", "i.details.other_risks", "c.details.other_local_factors"], "context_only", ["ea_flood_zones", "ea_rofsw", "bgs_geology_625k", "ne_designations"], "Separate environmental layers are evidence prompts, never an automatic risk rating or safety conclusion.");
add(["g.g3.construction"], "context_only", ["hmlr_inspire", ...customer], "Indicative extents establish neither ownership, boundaries, tenure nor rights.");
for (const element of ["f1", "f2", "f3", "f6", "f7", "f8"]) add([`f.${element}.construction`], "context_only", ["document_extraction", ...customer], "Reported services and certificate references do not prove current connections, operation or safety.");
for (const element of ["g1", "g2"]) add([`g.${element}.construction`], "context_only", customer, "Client-reported structure; construction and condition require inspection.");

/** Every field has an explicit policy; anything not safely mapped remains professional/manual. */
export function homeSurveyEvidenceInventory(template: FormTemplate) {
  return template.sections.flatMap(section => section.elements.flatMap(element => element.fields.map(field => {
    const path = `${section.key}.${element.key}.${field.key}`;
    return { path, section: section.label, element: element.label, label: field.label, ...(mappings[path] ?? { mode: "manual_only" as const, sources: [], boundary: "Surveyor-authored. No automatic ratings, defects, limitations, recommendations, opinion, qualifications, signature or declaration." }) };
  })));
}

export function evidenceMapping(path: string): EvidenceMapping | undefined { return mappings[path]; }
