export const categoryGroups = ["planning", "heritage", "energy", "land", "flood", "geology", "environment", "mining", "history"] as const;
export type CategoryGroup = (typeof categoryGroups)[number];

export const categoryGroupLabels: Record<CategoryGroup, string> = {
  planning: "Planning",
  heritage: "Heritage",
  energy: "Energy",
  land: "Land and title",
  flood: "Flooding",
  geology: "Ground and geology",
  environment: "Environmental designations",
  mining: "Mining",
  history: "History",
};

export type CategoryInfo = { label: string; group: CategoryGroup; caveat: string };

// Professional caveats shown wherever a category appears. They are fixed
// product wording and never generated per property.
export const categoryCatalogue: Record<string, CategoryInfo> = {
  conservation_area: { label: "Conservation area", group: "planning", caveat: "Planning coverage varies; confirm with the local planning authority." },
  listed_building: { label: "Listed building (planning record)", group: "planning", caveat: "Planning coverage varies; the official list entry is definitive." },
  article_4_direction: { label: "Article 4 direction", group: "planning", caveat: "Planning coverage varies; confirm with the local planning authority." },
  tree_preservation: { label: "Tree preservation", group: "planning", caveat: "Tree preservation data covers only some authorities." },
  scheduled_monument: { label: "Scheduled monument (planning record)", group: "planning", caveat: "Planning coverage varies; the official list entry is definitive." },
  registered_park_garden: { label: "Registered park and garden (planning record)", group: "planning", caveat: "Planning coverage varies." },
  world_heritage_site: { label: "World Heritage Site (planning record)", group: "planning", caveat: "Check the boundary and buffer zone with the authority." },
  green_belt: { label: "Green belt", group: "planning", caveat: "Planning coverage varies; confirm with the local plan." },
  listed_building_nhle: { label: "Listed building (National Heritage List)", group: "heritage", caveat: "Listing outlines are indicative; the list entry is the legal description." },
  listed_building_nhle_nearby: { label: "Listed buildings nearby", group: "heritage", caveat: "Nearby context only, not a match for this property." },
  scheduled_monument_nhle: { label: "Scheduled monument (National Heritage List)", group: "heritage", caveat: "Check the list entry for the protected extent." },
  registered_park_garden_nhle: { label: "Registered park and garden (National Heritage List)", group: "heritage", caveat: "Check the list entry for the registered area." },
  registered_battlefield_nhle: { label: "Registered battlefield", group: "heritage", caveat: "Check the list entry for the registered area." },
  world_heritage_site_nhle: { label: "World Heritage Site (National Heritage List)", group: "heritage", caveat: "Check the boundary and buffer zone with the authority." },
  energy_certificate: { label: "Energy performance certificate", group: "energy", caveat: "EPC record: verify during inspection. Certificates can be out of date." },
  inspire_indicative_extent: { label: "Registered freehold (indicative extent)", group: "land", caveat: "Indicative registered extent: not a legal title boundary, ownership record or title search." },
  planning_flood_zone_3: { label: "Flood Zone 3 (planning)", group: "flood", caveat: "Planning flood zone, not a property flood risk assessment." },
  planning_flood_zone_2: { label: "Flood Zone 2 (planning)", group: "flood", caveat: "Planning flood zone; not intersecting is not proof of no flood risk." },
  surface_water_high: { label: "Surface water risk: high", group: "flood", caveat: "Modelled surface water risk, separate from planning zones." },
  surface_water_medium: { label: "Surface water risk: medium", group: "flood", caveat: "Modelled surface water risk, separate from planning zones." },
  surface_water_low: { label: "Surface water risk: low", group: "flood", caveat: "Modelled surface water risk, separate from planning zones." },
  bedrock_geology: { label: "Bedrock geology", group: "geology", caveat: "Mapped geology requires interpretation; not a site investigation." },
  superficial_deposits: { label: "Superficial deposits", group: "geology", caveat: "Regional-scale mapping; absence on the map is not absence on site." },
  sssi: { label: "Site of Special Scientific Interest", group: "environment", caveat: "Check Natural England's citation." },
  sssi_nearby: { label: "SSSI nearby", group: "environment", caveat: "Nearby context only." },
  special_area_of_conservation: { label: "Special Area of Conservation", group: "environment", caveat: "Check the designation documents." },
  special_protection_area: { label: "Special Protection Area", group: "environment", caveat: "Check the designation documents." },
  ramsar_site: { label: "Ramsar site", group: "environment", caveat: "Check the designation documents." },
  national_landscape: { label: "National Landscape", group: "environment", caveat: "Planning policy applies." },
  national_park: { label: "National Park", group: "environment", caveat: "The National Park Authority is the planning authority." },
  ancient_woodland: { label: "Ancient woodland", group: "environment", caveat: "Indicative inventory." },
  ancient_woodland_nearby: { label: "Ancient woodland nearby", group: "environment", caveat: "Nearby context only." },
  sales_history: { label: "Registered sales", group: "history", caveat: "Linked by HM Land Registry's published transaction-to-UPRN look-up only. Not a complete ownership history." },
};

export function categoryInfo(category: string): CategoryInfo {
  return categoryCatalogue[category] ?? { label: category.replace(/_/g, " "), group: "environment", caveat: "Check the source for coverage and currency." };
}
