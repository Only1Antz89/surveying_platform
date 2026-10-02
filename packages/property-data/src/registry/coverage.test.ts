import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ukCountries } from "@surveynt/domain";
import type { PropertyLocation } from "../contract";
import { intelligenceProviders, mapLayerProviders } from "../providers";
import type { ProviderContext } from "../providers/types";
import { renderCoverageMarkdown } from "./coverage";
import { getSourceDefinition } from "./sources";

// Every capability is configured, so only country coverage can make a provider decline.
const context: ProviderContext = {
  now: new Date("2026-10-02T12:00:00Z"),
  env: { EPC_API_BASE_URL: "https://epc.example.test", EPC_API_TOKEN: "token" },
  spatial: { featuresAt: async () => [] },
  history: { salesForUprn: async () => ({ available: false, reason: "price_paid_not_imported" }) },
  scottishEpc: { certificatesForUprn: async () => ({ available: false }) },
};
const at = (country: PropertyLocation["country"]): PropertyLocation => ({ propertyId: "p", country, uprn: "990000000001", latitude: 55.95, longitude: -3.19, locationConfidence: "surveyor_confirmed", postcode: "EH1 1AA" });

describe("country routing", () => {
  it("never lets a provider answer outside its registered coverage", () => {
    for (const provider of intelligenceProviders) {
      const definition = getSourceDefinition(provider.key);
      expect(definition, provider.key).not.toBeNull();
      for (const country of ukCountries) {
        const applicability = provider.applicability(at(country), context);
        if (!definition!.coverage.includes(country)) expect(applicability, `${provider.key} in ${country}`).toMatchObject({ ok: false, status: "unsupported", coverage: "not_covered" });
      }
    }
  });

  it("gives each nation its own categories, so one country's results never stand in for another's", () => {
    const owners = new Map<string, string>();
    for (const provider of intelligenceProviders) for (const category of provider.categories) {
      expect(owners.get(category), `${category} is produced by ${owners.get(category)} and ${provider.key}`).toBeUndefined();
      owners.set(category, provider.key);
    }
    for (const provider of mapLayerProviders) expect(provider.definition.countries.every((country) => getSourceDefinition(provider.key)!.coverage.includes(country))).toBe(true);
  });

  it("keeps blocked sources out of enrichment and says Northern Ireland identity is unsupported", () => {
    expect(intelligenceProviders.some((provider) => getSourceDefinition(provider.key)?.registerStatus === "blocked")).toBe(false);
    expect(renderCoverageMarkdown()).toMatch(/Authoritative address resolution is \*\*unsupported\*\*/);
  });

  it("publishes an up-to-date coverage table", () => {
    const published = readFileSync(path.join(import.meta.dirname, "../../../../docs/property-intelligence/country-coverage.md"), "utf8");
    expect(published).toBe(renderCoverageMarkdown());
  });
});
