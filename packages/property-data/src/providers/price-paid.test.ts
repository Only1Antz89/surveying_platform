import { describe, expect, it } from "vitest";
import type { PropertyLocation } from "../contract";
import { pricePaidProvider } from "./price-paid";
import type { HistoryQuery, ProviderContext, SaleRecord } from "./types";

const location = (overrides: Partial<PropertyLocation> = {}): PropertyLocation => ({ propertyId: "p1", country: "ENG", uprn: "990000000002", latitude: 51.4544, longitude: -2.6198, locationConfidence: "surveyor_confirmed", postcode: "BS8 4JX", ...overrides });
const sale = (overrides: Partial<SaleRecord> = {}): SaleRecord => ({ transactionId: "8A1B2C3D-0000-4000-8000-000000000001", price: 425000, transferDate: "2019-03-12", propertyType: "T", newBuild: false, tenure: "F", ppdCategory: "A", linkedUprnCount: 1, ...overrides });
const history = (answer: Awaited<ReturnType<HistoryQuery["salesForUprn"]>>): HistoryQuery => ({ salesForUprn: async () => answer });
const context = (query?: HistoryQuery): ProviderContext => ({ now: new Date("2026-10-01T12:00:00Z"), env: {}, history: query });
const available = { available: true as const, pricePaidVersion: "2026-09", lookupVersion: "2026-09", publishedAt: "2026-09", postcodeAreas: null, unresolvedLinks: 0 };

describe("Price Paid provider", () => {
  it("needs England or Wales, a history store and a confirmed UPRN", () => {
    expect(pricePaidProvider.applicability(location({ country: "SCT" }), context(history({ ...available, sales: [] })))).toMatchObject({ ok: false, status: "unsupported", coverage: "not_covered" });
    expect(pricePaidProvider.applicability(location(), context())).toMatchObject({ ok: false, status: "not_configured" });
    expect(pricePaidProvider.applicability(location({ uprn: null }), context(history({ ...available, sales: [] })))).toMatchObject({ ok: false, status: "unsupported", message: expect.stringMatching(/confirmed UPRN/) });
  });

  it("reports an unimported dataset or look-up as not checked", async () => {
    for (const reason of ["price_paid_not_imported", "lookup_not_imported", "lookup_not_enabled"] as const) {
      const [result] = await pricePaidProvider.run(location(), context(history({ available: false, reason })));
      expect(result).toMatchObject({ status: "not_configured", coverage: "unknown" });
    }
  });

  it("does not answer outside a regional import", async () => {
    const [result] = await pricePaidProvider.run(location({ postcode: "M1 1AA" }), context(history({ ...available, postcodeAreas: ["BA", "BS"], sales: [sale()] })));
    expect(result).toMatchObject({ status: "not_configured", coverage: "not_covered", records: [] });
  });

  it("treats no linked sale as partial coverage, never proof of no sale", async () => {
    const [result] = await pricePaidProvider.run(location(), context(history({ ...available, sales: [], unresolvedLinks: 1 })));
    expect(result).toMatchObject({ status: "no_match", coverage: "partial" });
    expect(result.message).toMatch(/not a complete ownership history/);
    expect(result.message).toMatch(/1 linked sale is missing/);
  });

  it("returns exact-UPRN sales with labels and flags sales shared between properties", async () => {
    const [result] = await pricePaidProvider.run(location(), context(history({ ...available, sales: [sale(), sale({ transactionId: "8A1B2C3D-0000-4000-8000-000000000002", transferDate: "2005-06-01", price: 180000, linkedUprnCount: 3 })] })));
    expect(result).toMatchObject({ status: "matched", coverage: "partial", informationClass: "authoritative_external" });
    expect(result.records.map((record) => [record.matchMethod, record.confidence, record.data.sharedSale])).toEqual([["uprn_exact", "high", false], ["uprn_exact", "medium", true]]);
    expect(result.records[0]).toMatchObject({ sourceUpdatedAt: "2026-09", data: { propertyTypeLabel: "Terraced", tenureLabel: "Freehold", releaseDate: "2026-09" } });
    expect(result.message).toMatch(/price covers all of them/);
  });
});
