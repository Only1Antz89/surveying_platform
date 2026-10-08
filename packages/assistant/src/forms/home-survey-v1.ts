import type { FieldDefinition, FormTemplate, SectionDefinition, ServiceLevel } from "./types";
import { homeSurveyElements, homeSurveyFields, homeSurveyRatings } from "./home-survey-fields";

const elementFields: FieldDefinition[] = [
  { key: "construction", label: "Construction and materials", type: "long_text", fieldClass: "professional_assessment", requirement: "when_inspected", reportUse: "report", maxLength: 4000 },
  { key: "condition_rating", label: "Condition rating", type: "condition_rating", fieldClass: "professional_assessment", requirement: "when_inspected", reportUse: "report" },
  { key: "commentary", label: "Condition and surveyor commentary", type: "long_text", fieldClass: "professional_assessment", requirement: "when_inspected", requiredForServiceLevels: ["level_2", "level_3"], reportUse: "report", maxLength: 8000 },
  { key: "limitations", label: "Inspection limitations", type: "long_text", fieldClass: "professional_assessment", requirement: "optional", reportUse: "report", maxLength: 4000 },
  { key: "recommendations", label: "Recommendations and further investigation", type: "long_text", fieldClass: "professional_assessment", requirement: "optional", reportUse: "report", maxLength: 8000 },
  { key: "repairs", label: "Repairs and priorities", type: "long_text", fieldClass: "professional_assessment", requirement: "optional", requiredForServiceLevels: ["level_3"], reportUse: "report", maxLength: 8000 },
];
const fields = (key: keyof typeof homeSurveyFields, label: string): SectionDefinition => ({ key: key.toLowerCase(), label, elements: [{ key: "details", label, inspectable: false, fields: homeSurveyFields[key] }] });
const elements = (key: keyof typeof homeSurveyElements, label: string): SectionDefinition => ({ key: key.toLowerCase(), label, elements: homeSurveyElements[key].map(([id, title]) => ({ key: id.toLowerCase(), label: `${id} ${title}`, description: "Record current observations and limitations. External records do not establish the inspected condition.", inspectable: true, fields: elementFields })) });

function template(level: ServiceLevel, valuation = false): FormTemplate {
  const number = level.slice(-1);
  const sections = [fields("A", "A About the inspection"), fields("B", level === "level_1" ? "B Summary of condition ratings" : "B Overall opinion"), fields("C", "C About the property"), elements("D", "D Outside the property"), elements("E", "E Inside the property"), elements("F", "F Services"), elements("G", "G Grounds"), fields("H", "H Issues for legal advisers"), fields("I", "I Risks")];
  if (valuation) sections.push(fields("valuation", "J Property valuation"));
  if (level === "level_3") sections.push(fields("energy", "J Energy matters"));
  sections.push(fields("declaration", `${valuation || level === "level_3" ? "K" : "J"} Surveyor's declaration`));
  return { key: `surveynt-home-survey-level-${number}${valuation ? "-valuation" : ""}`, version: "1.0.0", title: `Home Survey Level ${number}${valuation ? " with valuation" : ""} — firm draft`, authoredBy: "Surveynt, adapted from the firm's Clifton recorder", contentLicence: "User-provided firm workflow. No RICS brand licence or compliance approval is asserted. Professional review and any required licences must be verified before production issue.", reviewStatus: "draft_requires_surveyor_review", jurisdictions: ["ENG", "WLS"], serviceLevels: [level], conditionRatingLabels: homeSurveyRatings, sections };
}
export const homeSurveyTemplates: readonly FormTemplate[] = [template("level_1"), template("level_2"), template("level_2", true), template("level_3")];
