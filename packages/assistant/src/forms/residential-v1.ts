import type { ElementDefinition, FieldDefinition, FormTemplate } from "./types";

// Surveynt-authored residential inspection template. It deliberately contains
// no RICS or other third-party standard text. Firms holding licensed template
// wording map it through their own approved wording library (A5). The element
// taxonomy and requirements still need review by a qualified surveyor before
// production use, which `reviewStatus` records.

const options = (...values: [string, string][]) => values.map(([value, label]) => ({ value, label }));

function buildingElement(key: string, label: string, description: string, extra: FieldDefinition[] = []): ElementDefinition {
  return {
    key,
    label,
    description,
    inspectable: true,
    fields: [
      { key: "construction", label: "Construction and materials observed", type: "long_text", fieldClass: "factual_sourced", requirement: "when_inspected", reportUse: "report", maxLength: 4000, guidance: "Describe what was seen. Sourced descriptions (for example from an EPC) are suggestions until verified on site." },
      { key: "condition_rating", label: "Condition rating", type: "condition_rating", fieldClass: "professional_assessment", requirement: "when_inspected", requiredForServiceLevels: ["level_1", "level_2", "level_3"], reportUse: "report", guidance: "Selected by the surveyor. Never set from a photograph or external record alone." },
      { key: "commentary", label: "Surveyor commentary", type: "long_text", fieldClass: "professional_assessment", requirement: "when_inspected", requiredForServiceLevels: ["level_2", "level_3"], reportUse: "report", maxLength: 8000 },
      { key: "limitations", label: "Inspection limitations", type: "long_text", fieldClass: "factual_sourced", requirement: "optional", reportUse: "report", maxLength: 2000, guidance: "Required by completion checks when the element was only partly inspected, not inspected or inaccessible." },
      ...extra,
    ],
  };
}

const ageBands = options(
  ["before_1900", "Before 1900"], ["1900_1929", "1900–1929"], ["1930_1949", "1930–1949"], ["1950_1966", "1950–1966"],
  ["1967_1975", "1967–1975"], ["1976_1982", "1976–1982"], ["1983_1990", "1983–1990"], ["1991_1995", "1991–1995"],
  ["1996_2002", "1996–2002"], ["2003_2006", "2003–2006"], ["2007_2011", "2007–2011"], ["2012_onwards", "2012 onwards"],
);

export const residentialTemplateV1: FormTemplate = {
  key: "surveynt-residential",
  version: "1.0.0",
  title: "Surveynt residential inspection",
  authoredBy: "Surveynt",
  contentLicence: "Surveynt proprietary template. Contains no third-party standard text.",
  reviewStatus: "draft_requires_surveyor_review",
  jurisdictions: ["ENG", "WLS", "SCT", "NIR"],
  serviceLevels: ["level_1", "level_2", "level_3", "bespoke"],
  conditionRatingLabels: {
    "1": "1 — no repair currently needed",
    "2": "2 — repair or replacement needed, not considered serious or urgent",
    "3": "3 — serious defect or urgent repair, replacement or investigation needed",
    NI: "NI — not inspected",
  },
  sections: [
    {
      key: "about",
      label: "About the property",
      elements: [{
        key: "property",
        label: "Property",
        inspectable: false,
        fields: [
          { key: "property_type", label: "Property type", type: "enum", fieldClass: "factual_sourced", requirement: "always", reportUse: "report", proposalSources: ["epc_england_wales", "scottish_epc"], options: options(["house", "House"], ["bungalow", "Bungalow"], ["flat", "Flat"], ["maisonette", "Maisonette"], ["park_home", "Park home"], ["other", "Other"]) },
          { key: "built_form", label: "Built form", type: "enum", fieldClass: "factual_sourced", requirement: "always", reportUse: "report", proposalSources: ["epc_england_wales", "scottish_epc"], options: options(["detached", "Detached"], ["semi_detached", "Semi-detached"], ["mid_terrace", "Mid-terrace"], ["end_terrace", "End-terrace"], ["enclosed_mid_terrace", "Enclosed mid-terrace"], ["enclosed_end_terrace", "Enclosed end-terrace"], ["purpose_built_block", "Purpose-built block"], ["converted_building", "Converted building"], ["other", "Other"]) },
          { key: "construction_period", label: "Approximate construction period", type: "enum", fieldClass: "factual_sourced", requirement: "always", reportUse: "report", proposalSources: ["epc_england_wales", "scottish_epc"], options: ageBands, guidance: "An EPC age band is a recorded estimate. Verify against what is seen and any documents." },
          { key: "year_built_estimate", label: "Surveyor's estimated year of construction", type: "integer", fieldClass: "professional_assessment", requirement: "optional", reportUse: "report", min: 1000, max: 2100 },
          { key: "storeys", label: "Storeys above ground", type: "integer", fieldClass: "factual_sourced", requirement: "always", reportUse: "report", min: 1, max: 100 },
          { key: "tenure", label: "Tenure (as reported)", type: "enum", fieldClass: "factual_sourced", requirement: "optional", reportUse: "report", options: options(["freehold", "Freehold"], ["leasehold", "Leasehold"], ["commonhold", "Commonhold"], ["owner_occupied_scotland", "Ownership (Scotland)"], ["other", "Other"]), guidance: "Usually a client or legal statement, not an inspected fact. Legal advisers confirm tenure." },
          { key: "listed_status", label: "Listed building record", type: "enum", fieldClass: "factual_sourced", requirement: "always", reportUse: "report", proposalSources: ["historic_england_nhle", "planning_data", "cadw_listed_buildings", "hes_designations", "ni_hed_listed_buildings"], options: options(["listed", "Listed: record found"], ["no_record_found", "No record found in checked sources"], ["not_checked", "Not checked"]), guidance: "'No record found' is not proof that a building is unlisted." },
          { key: "listing_grade", label: "Listing grade or category (as recorded)", type: "text", fieldClass: "factual_sourced", requirement: "optional", reportUse: "report", maxLength: 40, proposalSources: ["historic_england_nhle", "planning_data", "cadw_listed_buildings", "hes_designations", "ni_hed_listed_buildings"] },
          { key: "conservation_area", label: "Conservation area record", type: "enum", fieldClass: "factual_sourced", requirement: "always", reportUse: "report", proposalSources: ["planning_data", "hes_designations"], options: options(["in_area", "Within a recorded conservation area"], ["no_record_found", "No record found in checked sources"], ["not_checked", "Not checked"]), guidance: "Planning Data coverage varies by local authority. Confirm with the local planning authority." },
          { key: "energy_rating", label: "Recorded energy rating", type: "enum", fieldClass: "factual_sourced", requirement: "optional", reportUse: "report", proposalSources: ["epc_england_wales", "scottish_epc"], options: options(["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"], ["E", "E"], ["F", "F"], ["G", "G"]) },
          { key: "energy_certificate_reference", label: "Energy certificate reference", type: "text", fieldClass: "clerical", requirement: "optional", reportUse: "report", maxLength: 40, proposalSources: ["epc_england_wales", "scottish_epc"] },
          { key: "extensions_present", label: "Extensions or alterations observed", type: "boolean", fieldClass: "factual_sourced", requirement: "always", reportUse: "report" },
          { key: "accommodation", label: "Accommodation summary", type: "long_text", fieldClass: "factual_sourced", requirement: "always", reportUse: "report", maxLength: 4000 },
        ],
      }],
    },
    {
      key: "inspection",
      label: "Inspection",
      elements: [{
        key: "visit",
        label: "Inspection visit",
        inspectable: false,
        fields: [
          { key: "inspection_date", label: "Inspection date", type: "date", fieldClass: "clerical", requirement: "always", reportUse: "report" },
          { key: "weather", label: "Weather during inspection", type: "text", fieldClass: "clerical", requirement: "always", reportUse: "report", maxLength: 200 },
          { key: "occupancy", label: "Occupancy", type: "enum", fieldClass: "factual_sourced", requirement: "always", reportUse: "report", options: options(["occupied", "Occupied"], ["vacant", "Vacant"]) },
          { key: "furnishing", label: "Furnishing and floor coverings", type: "enum", fieldClass: "factual_sourced", requirement: "always", reportUse: "report", options: options(["furnished", "Furnished"], ["part_furnished", "Part furnished"], ["unfurnished", "Unfurnished"]) },
          { key: "general_limitations", label: "General limitations", type: "long_text", fieldClass: "factual_sourced", requirement: "optional", reportUse: "report", maxLength: 4000 },
        ],
      }],
    },
    {
      key: "outside",
      label: "Outside the property",
      elements: [
        buildingElement("chimneys", "Chimney stacks", "Stacks, pots, flashings and associated structures."),
        buildingElement("roof_coverings", "Roof coverings", "Coverings, ridges, verges, valleys and flashings."),
        buildingElement("rainwater_goods", "Rainwater pipes and gutters", "Gutters, downpipes and outlets."),
        buildingElement("main_walls", "Main walls", "External walls, damp-proof course and foundations where visible."),
        buildingElement("windows", "Windows", "Window frames, glazing and external sills."),
        buildingElement("external_doors", "Outside doors", "External doors including patio doors."),
        buildingElement("conservatory_porch", "Conservatory and porches", "Attached conservatories and porches."),
        buildingElement("external_joinery", "Other joinery and finishes", "Fascias, soffits, bargeboards and external decorations."),
        buildingElement("other_outside", "Other outside elements", "Balconies, external stairs and other attached features."),
      ],
    },
    {
      key: "inside",
      label: "Inside the property",
      elements: [
        buildingElement("roof_structure", "Roof structure", "Roof space, structure, insulation and ventilation where accessible."),
        buildingElement("ceilings", "Ceilings", "Ceiling finishes and visible structure."),
        buildingElement("walls_partitions", "Walls and partitions", "Internal walls, partitions and plaster finishes."),
        buildingElement("floors", "Floors", "Floor structure and surfaces where visible."),
        buildingElement("fireplaces", "Fireplaces, chimney breasts and flues", "Internal chimney breasts, fireplaces and flues."),
        buildingElement("built_in_fittings", "Built-in fittings", "Kitchen and other built-in fittings."),
        buildingElement("woodwork", "Woodwork", "Staircases, doors, skirtings and internal joinery."),
        buildingElement("bathroom_fittings", "Bathroom fittings", "Sanitary fittings and associated finishes."),
        buildingElement("other_inside", "Other inside elements", "Cellars, basements and other internal areas."),
      ],
    },
    {
      key: "services",
      label: "Services",
      elements: [
        buildingElement("electricity", "Electricity", "Visible installation only. Services are not tested unless agreed."),
        buildingElement("gas_oil", "Gas or oil", "Visible installation only."),
        buildingElement("water", "Water", "Supply and visible pipework."),
        buildingElement("heating", "Heating", "Heating system and visible components."),
        buildingElement("water_heating", "Water heating", "Hot water provision."),
        buildingElement("drainage", "Drainage", "Visible drainage and inspection chambers where lifted."),
        buildingElement("common_services", "Common services", "Shared or communal services."),
      ],
    },
    {
      key: "grounds",
      label: "Grounds and shared areas",
      elements: [
        buildingElement("garaging", "Garage and parking", "Garages and parking structures."),
        buildingElement("outbuildings", "Permanent outbuildings", "Sheds, workshops and other permanent structures."),
        buildingElement("boundaries_grounds", "Boundaries and grounds", "Boundary structures, paths, retaining walls and grounds."),
        buildingElement("communal_areas", "Communal areas", "Shared entrances, stairs, lifts and corridors for flats and maisonettes."),
      ],
    },
    {
      key: "matters",
      label: "Matters for legal advisers and risks",
      elements: [
        {
          key: "legal",
          label: "Matters for legal advisers",
          inspectable: false,
          fields: [
            { key: "approvals", label: "Planning, building control and approvals to confirm", type: "long_text", fieldClass: "professional_assessment", requirement: "optional", reportUse: "report", maxLength: 4000 },
            { key: "guarantees", label: "Guarantees and certificates to obtain", type: "long_text", fieldClass: "factual_sourced", requirement: "optional", reportUse: "report", maxLength: 4000 },
            { key: "other_legal", label: "Other matters", type: "long_text", fieldClass: "professional_assessment", requirement: "optional", reportUse: "report", maxLength: 4000 },
          ],
        },
        {
          key: "risks",
          label: "Risks",
          inspectable: false,
          fields: [
            { key: "risks_to_building", label: "Risks to the building", type: "long_text", fieldClass: "professional_assessment", requirement: "optional", reportUse: "report", maxLength: 4000 },
            { key: "risks_to_grounds", label: "Risks to the grounds", type: "long_text", fieldClass: "professional_assessment", requirement: "optional", reportUse: "report", maxLength: 4000 },
            { key: "risks_to_people", label: "Risks to people", type: "long_text", fieldClass: "professional_assessment", requirement: "optional", reportUse: "report", maxLength: 4000 },
          ],
        },
      ],
    },
    {
      key: "summary",
      label: "Summary",
      elements: [{
        key: "opinion",
        label: "Overall opinion",
        inspectable: false,
        fields: [
          { key: "overall_opinion", label: "Overall opinion", type: "long_text", fieldClass: "professional_assessment", requirement: "always", requiredForServiceLevels: ["level_2", "level_3"], reportUse: "report", maxLength: 8000 },
        ],
      }],
    },
  ],
};
