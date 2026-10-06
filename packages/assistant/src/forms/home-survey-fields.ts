import type { FieldDefinition } from "./types";

// Mechanical field-label mapping from the user-owned Clifton recorder; not an approved RICS publication.
export const homeSurveyFields = {
  "A": [
    {
      "key": "surveyor_name",
      "label": "Surveyor's name",
      "type": "text",
      "fieldClass": "clerical",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "rics_number",
      "label": "Surveyor's RICS number",
      "type": "text",
      "fieldClass": "clerical",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "company_name",
      "label": "Company name",
      "type": "text",
      "fieldClass": "clerical",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "inspection_date",
      "label": "Date of the inspection",
      "type": "date",
      "fieldClass": "clerical",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "report_reference",
      "label": "Report reference number",
      "type": "text",
      "fieldClass": "clerical",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "related_party_disclosure",
      "label": "Related party disclosure",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "property_address",
      "label": "Full address and postcode of the property",
      "type": "long_text",
      "fieldClass": "clerical",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "weather",
      "label": "Weather conditions when the inspection took place",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "property_status",
      "label": "Status of the property when the inspection took place",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "access_arrangements",
      "label": "Access arrangements supplied by the client",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "client_brief",
      "label": "Client's concerns and instructions",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "limitations",
      "label": "Limitations on the inspection",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    }
  ],
  "B": [
    {
      "key": "overall_opinion",
      "label": "Overall opinion of the property",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "documents_requested",
      "label": "Documents to request before exchange of contracts",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    }
  ],
  "C": [
    {
      "key": "property_type",
      "label": "Type of property",
      "type": "text",
      "fieldClass": "professional_assessment",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "built_year",
      "label": "Approximate year the property was built",
      "type": "text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "extended_year",
      "label": "Approximate year the property was extended",
      "type": "text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "converted_year",
      "label": "Approximate year the property was converted",
      "type": "text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "flat_information",
      "label": "Information relevant to flats and maisonettes",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "construction",
      "label": "Construction",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "accommodation",
      "label": "Accommodation",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "energy_rating",
      "label": "Energy efficiency rating",
      "type": "text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "energy_issues",
      "label": "Issues relating to energy efficiency",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "main_services",
      "label": "Main services present",
      "type": "text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "central_heating",
      "label": "Central heating",
      "type": "text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "grounds",
      "label": "Grounds",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "location",
      "label": "Location",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "facilities",
      "label": "Facilities",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "local_environment",
      "label": "Local environment",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "other_local_factors",
      "label": "Other local factors",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    }
  ],
  "H": [
    {
      "key": "regulations",
      "label": "H1 Regulation",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "guarantees",
      "label": "H2 Guarantees",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "other_matters",
      "label": "H3 Other matters",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    }
  ],
  "I": [
    {
      "key": "building_risks",
      "label": "I1 Risks to the building",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "grounds_risks",
      "label": "I2 Risks to the grounds",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "people_risks",
      "label": "I3 Risks to people",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "other_risks",
      "label": "I4 Other risks or hazards",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    }
  ],
  "declaration": [
    {
      "key": "surveyor_name",
      "label": "Surveyor's name",
      "type": "text",
      "fieldClass": "clerical",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "qualifications",
      "label": "Qualifications",
      "type": "text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "rics_number",
      "label": "RICS number",
      "type": "text",
      "fieldClass": "clerical",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "company_name",
      "label": "Company",
      "type": "text",
      "fieldClass": "clerical",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "company_address",
      "label": "Company address",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "contact_details",
      "label": "Contact details",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "signature_date",
      "label": "Date this report was signed",
      "type": "date",
      "fieldClass": "professional_assessment",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "declaration",
      "label": "Surveyor's declaration",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 8000
    }
  ],
  "valuation": [
    {
      "key": "valuation_purpose",
      "label": "Purpose of the valuation",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "basis_of_value",
      "label": "Basis of value",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "market_value",
      "label": "Market value",
      "type": "text",
      "fieldClass": "professional_assessment",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "agreed_price",
      "label": "Agreed purchase price (client supplied)",
      "type": "text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "reinstatement_cost",
      "label": "Reinstatement cost",
      "type": "text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "valuation_date",
      "label": "Valuation date",
      "type": "date",
      "fieldClass": "professional_assessment",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "tenure",
      "label": "Tenure",
      "type": "text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 1000
    },
    {
      "key": "tenancies",
      "label": "Tenancies",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "assumptions",
      "label": "Assumptions and valuation basis",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "always",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "comparable_evidence",
      "label": "Comparable evidence and market commentary",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    }
  ],
  "energy": [
    {
      "key": "energy_efficiency",
      "label": "J1 Energy efficiency",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "insulation",
      "label": "J2 Insulation",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "heating_energy",
      "label": "J3 Heating and energy systems",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    },
    {
      "key": "further_energy_advice",
      "label": "J4 Further energy matters",
      "type": "long_text",
      "fieldClass": "professional_assessment",
      "requirement": "optional",
      "reportUse": "report",
      "maxLength": 8000
    }
  ]
} satisfies Record<string, FieldDefinition[]>;
export const homeSurveyElements = {
  "D": [
    [
      "D1",
      "Chimney stacks"
    ],
    [
      "D2",
      "Roof coverings"
    ],
    [
      "D3",
      "Rainwater pipes and gutters"
    ],
    [
      "D4",
      "Main walls"
    ],
    [
      "D5",
      "Windows"
    ],
    [
      "D6",
      "Outside doors (including patio doors)"
    ],
    [
      "D7",
      "Conservatory and porches"
    ],
    [
      "D8",
      "Other joinery and finishes"
    ],
    [
      "D9",
      "Other"
    ]
  ],
  "E": [
    [
      "E1",
      "Roof structure"
    ],
    [
      "E2",
      "Ceilings"
    ],
    [
      "E3",
      "Walls and partitions"
    ],
    [
      "E4",
      "Floors"
    ],
    [
      "E5",
      "Fireplaces, chimney breasts and flues"
    ],
    [
      "E6",
      "Built-in fittings"
    ],
    [
      "E7",
      "Woodwork"
    ],
    [
      "E8",
      "Bathroom fittings"
    ],
    [
      "E9",
      "Other"
    ]
  ],
  "F": [
    [
      "F1",
      "Electricity"
    ],
    [
      "F2",
      "Gas / oil"
    ],
    [
      "F3",
      "Water"
    ],
    [
      "F4",
      "Heating"
    ],
    [
      "F5",
      "Water heating"
    ],
    [
      "F6",
      "Drainage"
    ],
    [
      "F7",
      "Common services"
    ],
    [
      "F8",
      "Other services / features"
    ]
  ],
  "G": [
    [
      "G1",
      "Garage"
    ],
    [
      "G2",
      "Permanent outbuildings and other structures"
    ],
    [
      "G3",
      "Other"
    ]
  ]
};
export const homeSurveyRatings = {
  "1": "No repair currently needed",
  "2": "Repair or replacement needed, but not urgent",
  "3": "Serious defect requiring urgent action",
  "NI": "Not inspected"
};
