/** Generic illustrations only. This selector never writes identity or survey data. */
export const propertyArtwork = {
  terrace: { src: "/surveynt-architecture.webp", title: "Period terrace", alt: "Illustrative cutaway of a British period terrace" },
  detached: { src: "/property-artwork/detached.webp", title: "Detached house", alt: "Illustrative cutaway of a detached British house" },
  semi: { src: "/property-artwork/semi-detached.webp", title: "Semi-detached houses", alt: "Illustrative cutaway of British semi-detached houses and their shared party wall" },
  bungalow: { src: "/property-artwork/bungalow.webp", title: "Bungalow", alt: "Illustrative cutaway of a single-storey British bungalow" },
  apartments: { src: "/property-artwork/apartments.webp", title: "Apartments", alt: "Illustrative cutaway of a British apartment building with separate flats" },
  commercial: { src: "/property-artwork/commercial.webp", title: "Commercial premises", alt: "Illustrative cutaway of British offices and a light-industrial workshop" },
  land: { src: "/property-artwork/rural-land.webp", title: "Rural land", alt: "Illustrative English fields, hedgerows and a rural land section" },
  terracedRow: { src: "/property-artwork/terraced-row.webp", title: "Terraced street", alt: "Illustrative cutaway of a fictional British terraced row" },
  cottage: { src: "/property-artwork/cottage.webp", title: "Stone cottage", alt: "Illustrative cutaway of a fictional English stone cottage" },
  maisonette: { src: "/property-artwork/maisonette.webp", title: "Maisonette", alt: "Illustrative sectional model of a fictional British maisonette" },
  office: { src: "/property-artwork/office.webp", title: "Office building", alt: "Illustrative cutaway of a fictional contemporary British office building" },
  warehouse: { src: "/property-artwork/warehouse.webp", title: "Industrial warehouse", alt: "Illustrative cutaway of a fictional British warehouse and office" },
  woodland: { src: "/property-artwork/woodland.webp", title: "Woodland", alt: "Illustrative English woodland terrain, not a boundary or geological survey" },
  developmentLand: { src: "/property-artwork/development-land.webp", title: "Development land", alt: "Illustrative brownfield site with conceptual massing, not approved plans or ground-condition evidence" },
  coastalWetland: { src: "/property-artwork/coastal-wetland.webp", title: "Coastal and wetland terrain", alt: "Illustrative coastal marsh and dunes, not flood-risk or geological evidence" },
} as const;

/** Shared form suggestions: custom/legacy descriptions remain supported. */
export const propertyTypeOptions = [
  { label: "Terraced house", artwork: "terrace" },
  { label: "Terraced row", artwork: "terracedRow" },
  { label: "Detached house", artwork: "detached" },
  { label: "Semi-detached house", artwork: "semi" },
  { label: "Bungalow", artwork: "bungalow" },
  { label: "Stone cottage", artwork: "cottage" },
  { label: "Flat / apartment", artwork: "apartments" },
  { label: "Maisonette", artwork: "maisonette" },
  { label: "Office building", artwork: "office" },
  { label: "Industrial warehouse", artwork: "warehouse" },
  { label: "Commercial / retail premises", artwork: "commercial" },
  { label: "Agricultural / rural land", artwork: "land" },
  { label: "Woodland", artwork: "woodland" },
  { label: "Brownfield / development land", artwork: "developmentLand" },
  { label: "Coastal / wetland terrain", artwork: "coastalWetland" },
] as const satisfies readonly { label: string; artwork: keyof typeof propertyArtwork }[];

export function artworkForPropertyType(propertyType: string | null | undefined) {
  const type = propertyType?.trim().toLowerCase().replace(/[_\u2010-\u2015]/g, " ").replace(/\s+/g, " ") ?? "";
  const exact = propertyTypeOptions.find(option => option.label.toLowerCase() === type);
  if (exact) return { ...propertyArtwork[exact.artwork], generic: false };
  // Building subtype beats contextual words such as "rural" or "coastal".
  if (/\bbungalow\b/.test(type)) return { ...propertyArtwork.bungalow, generic: false };
  if (/\bmaisonettes?\b/.test(type)) return { ...propertyArtwork.maisonette, generic: false };
  if (/\bcottages?\b/.test(type)) return { ...propertyArtwork.cottage, generic: false };
  if (/\b(flat|flats|apartment|apartments)\b/.test(type)) return { ...propertyArtwork.apartments, generic: false };
  if (/\bterraced (row|street)\b/.test(type)) return { ...propertyArtwork.terracedRow, generic: false };
  if (/\bsemi(?:[ -]?detached)?\b/.test(type)) return { ...propertyArtwork.semi, generic: false };
  if (/\bdetached\b/.test(type)) return { ...propertyArtwork.detached, generic: false };
  if (/\b(terrace|terraced|townhouse)\b/.test(type)) return { ...propertyArtwork.terrace, generic: false };
  if (!/\b(land|plot|site)\b/.test(type)) {
    if (/\b(warehouse|industrial|workshop)\b/.test(type)) return { ...propertyArtwork.warehouse, generic: false };
    if (/\b(offices|office)\b/.test(type)) return { ...propertyArtwork.office, generic: false };
    if (/\b(commercial|retail|shop)\b/.test(type)) return { ...propertyArtwork.commercial, generic: false };
  }
  if (/\b(woodland|forest|forestry)\b/.test(type)) return { ...propertyArtwork.woodland, generic: false };
  if (/\b(coastal|coast|wetland|wetlands|marsh|saltmarsh|dunes)\b/.test(type)) return { ...propertyArtwork.coastalWetland, generic: false };
  if (/\b(brownfield|development land|development site|building plot)\b/.test(type)) return { ...propertyArtwork.developmentLand, generic: false };
  if (/\b(land|plot|pasture|farm|farmland|arable|field)\b/.test(type)) return { ...propertyArtwork.land, generic: false };
  if (/\b(warehouse|industrial|workshop)\b/.test(type)) return { ...propertyArtwork.warehouse, generic: false };
  if (/\b(offices|office)\b/.test(type)) return { ...propertyArtwork.office, generic: false };
  if (/\b(commercial|office|offices|industrial|warehouse|retail|shop|workshop)\b/.test(type)) return { ...propertyArtwork.commercial, generic: false };
  return { ...propertyArtwork.terrace, title: "Generic architectural illustration", generic: true };
}
