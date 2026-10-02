import type { ProviderRecord } from "../contract";
import { result, type IntelligenceProvider } from "./types";

const sourceKey = "hmlr_price_paid";

export const propertyTypeLabels = { D: "Detached", S: "Semi-detached", T: "Terraced", F: "Flat or maisonette", O: "Other" } as const;
export const tenureLabels = { F: "Freehold", L: "Leasehold", U: "Unknown" } as const;
export const ppdCategoryLabels = { A: "Standard price paid", B: "Additional price paid (for example repossession, buy-to-let or a sale to a company)" } as const;

const notProof = "Sales appear only when HM Land Registry links the sale to this UPRN. Sales before 1995, transfers not for full market value, and sales without a published link (more common for land and garages) are not shown, so this is not a complete ownership history.";

/**
 * Registered sales for the property's confirmed UPRN, linked only through HM
 * Land Registry's published transaction-to-UPRN look-up. No address or
 * distance matching is ever used.
 */
export const pricePaidProvider: IntelligenceProvider = {
  key: sourceKey,
  categories: ["sales_history"],
  applicability(location, context) {
    if (location.country !== "ENG" && location.country !== "WLS") return { ok: false, status: "unsupported", message: location.country ? "Price Paid Data covers England and Wales only." : "Set the property's country to check sales history.", coverage: location.country ? "not_covered" : "unknown" };
    if (!context.history) return { ok: false, status: "not_configured", message: "Sales history data is not available in this environment.", coverage: "unknown" };
    if (!location.uprn) return { ok: false, status: "unsupported", message: "Sales are linked by confirmed UPRN only. Confirm the property's UPRN to check them.", coverage: "unknown" };
    return { ok: true };
  },
  async run(location, context) {
    const found = await context.history!.salesForUprn(location.uprn!);
    if (!found.available) {
      const message = found.reason === "price_paid_not_imported" ? "Price Paid Data has not been imported for this environment, so sales were not checked."
        : found.reason === "lookup_not_imported" ? "HM Land Registry's transaction-to-UPRN look-up has not been imported, so sales cannot be linked and were not checked."
        : "The transaction-to-UPRN look-up has not been enabled after verification, so sales were not checked.";
      return [result(sourceKey, { category: "sales_history", status: "not_configured", coverage: "unknown", now: context.now, message })];
    }
    const base = { category: "sales_history", now: context.now, datasetVersion: `${found.pricePaidVersion} (look-up ${found.lookupVersion})` };
    const area = location.postcode ? /^[A-Z]{1,2}/.exec(location.postcode.toUpperCase())?.[0] ?? null : null;
    if (found.postcodeAreas && (!area || !found.postcodeAreas.includes(area))) {
      return [result(sourceKey, { ...base, status: "not_configured", coverage: "not_covered", message: `Price Paid Data has only been imported for postcode areas ${found.postcodeAreas.join(", ")}, so sales for this property were not checked.` })];
    }
    const unresolved = found.unresolvedLinks ? ` ${found.unresolvedLinks} linked sale${found.unresolvedLinks === 1 ? " is" : "s are"} missing from the imported Price Paid version and ${found.unresolvedLinks === 1 ? "is" : "are"} not shown.` : "";
    if (!found.sales.length) {
      return [result(sourceKey, { ...base, status: "no_match", coverage: "partial", message: `No sale is linked to this UPRN in the imported data.${unresolved} ${notProof}` })];
    }
    const records: ProviderRecord[] = found.sales.map((sale) => ({
      sourceRecordId: sale.transactionId,
      category: "sales_history",
      // No Price Paid address field is stored or returned.
      data: {
        transferDate: sale.transferDate,
        price: sale.price,
        propertyType: sale.propertyType,
        propertyTypeLabel: propertyTypeLabels[sale.propertyType],
        newBuild: sale.newBuild,
        tenure: sale.tenure,
        tenureLabel: tenureLabels[sale.tenure],
        ppdCategory: sale.ppdCategory,
        ppdCategoryLabel: ppdCategoryLabels[sale.ppdCategory],
        linkedUprnCount: sale.linkedUprnCount,
        sharedSale: sale.linkedUprnCount > 1,
        // Release label as published (often a month); sourceUpdatedAt is a timestamp and would add a day.
        releaseDate: found.publishedAt,
      },
      evidence: [{ label: "HM Land Registry Price Paid Data", url: "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads" }],
      matchMethod: "uprn_exact",
      confidence: sale.linkedUprnCount > 1 ? "medium" : "high",
      sourceUpdatedAt: found.publishedAt,
    }));
    const shared = found.sales.some((sale) => sale.linkedUprnCount > 1) ? " Some sales were linked to several properties; their price covers all of them." : "";
    return [result(sourceKey, { ...base, status: "matched", records, coverage: "partial", message: `Registered sales linked by HM Land Registry to this UPRN.${shared}${unresolved} ${notProof}` })];
  },
};
