import { ukCountries, ukCountryLabels, type UkCountry } from "@surveynt/domain";
import { intelligenceProviders } from "../providers";
import { sourceDefinitions } from "./sources";

/** Which registered source covers which country, and whether an enrichment provider uses it. */
export function coverageMatrix() {
  return sourceDefinitions.map((source) => ({
    key: source.key, name: source.name, organisation: source.organisation, registerStatus: source.registerStatus, accessMethod: source.accessMethod,
    countries: Object.fromEntries(ukCountries.map((country) => [country, source.coverage.includes(country)])) as Record<UkCountry, boolean>,
    usage: source.registerStatus === "blocked" ? "no (blocked)"
      : intelligenceProviders.some((provider) => provider.key === source.key) ? "enrichment"
        : source.category === "identity" ? "address and UPRN identity"
          : source.key === "hmlr_ppd_uprn_lookup" ? "with Price Paid" : "no",
  }));
}

const notes: Record<UkCountry, string[]> = {
  ENG: ["Most national datasets are England-only; each is used only for properties recorded as in England."],
  WLS: ["Natural Resources Wales flood zones and Cadw listings are used for Welsh properties. Environment Agency and Historic England data are never substituted.", "EPC, Price Paid, INSPIRE and OS Open UPRN cover England and Wales or Great Britain."],
  SCT: ["Historic Environment Scotland designations, SEPA flood maps and the Scottish EPC Register are used for Scottish properties. England and Wales EPC data is never used.", "Price Paid and INSPIRE do not cover Scotland; Registers of Scotland data is not integrated."],
  NIR: ["Authoritative address resolution is **unsupported**: OS Open UPRN covers Great Britain only, Pointer is not licensed, and postcodes.io lookups for BT postcodes stay disabled until the Land & Property Services terms are confirmed.", "Energy certificates are **unsupported**: no open publication was identified.", "Listed buildings come from the Historic Environment Division only once imported. All other land, flood and history sources report \"not covered\"."],
};

/** The published coverage table (docs/property-intelligence/country-coverage.md), generated from the registry. */
export function renderCoverageMarkdown() {
  const rows = coverageMatrix();
  const lines = [
    "# Country coverage",
    "",
    "Generated from the source registry and provider list by `pnpm --filter @surveynt/property-data coverage`. A test fails if this file is out of date.",
    "",
    "A ✓ means the source covers the country. A source is used only after an operator has verified and enabled it; \"pending\" and \"blocked\" sources are disabled. A property outside a source's coverage gets \"not covered\" for it, never \"no record\".",
    "",
    `| Source | Publisher | Register | ${ukCountries.join(" | ")} | Used for |`,
    `|---|---|---|${ukCountries.map(() => "---").join("|")}|---|`,
    ...rows.map((row) => `| \`${row.key}\` ${row.name} | ${row.organisation} | ${row.registerStatus} | ${ukCountries.map((country) => (row.countries[country] ? "✓" : "—")).join(" | ")} | ${row.usage} |`),
    "",
    ...ukCountries.flatMap((country) => [`## ${ukCountryLabels[country]}`, "", `Sources covering ${ukCountryLabels[country]}: ${rows.filter((row) => row.countries[country]).length} of ${rows.length}.`, "", ...notes[country].map((note) => `- ${note}`), ""]),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}
