import type { ProviderRecord } from "../contract";
import { result, type IntelligenceProvider } from "./types";

const sourceKey = "scottish_epc";

/**
 * Scottish EPC Register certificates for the property's confirmed UPRN, from
 * an imported extract. Scotland only: the England and Wales register is never
 * used for Scottish properties, or the reverse.
 */
export const scottishEpcProvider: IntelligenceProvider = {
  key: sourceKey,
  categories: ["energy_certificate_scotland"],
  applicability(location, context) {
    if (location.country !== "SCT") return { ok: false, status: "unsupported", message: location.country ? "The Scottish EPC Register covers Scotland only." : "Set the property's country to check energy certificates.", coverage: location.country ? "not_covered" : "unknown" };
    if (!context.scottishEpc) return { ok: false, status: "not_configured", message: "Scottish EPC data is not available in this environment.", coverage: "unknown" };
    if (!location.uprn) return { ok: false, status: "unsupported", message: "Scottish EPC records are matched by confirmed UPRN only. Confirm the property's UPRN to check them.", coverage: "unknown" };
    return { ok: true };
  },
  async run(location, context) {
    const found = await context.scottishEpc!.certificatesForUprn(location.uprn!);
    const base = { category: "energy_certificate_scotland", now: context.now };
    if (!found.available) return [result(sourceKey, { ...base, status: "not_configured", coverage: "unknown", message: "No Scottish EPC Register extract has been imported, so certificates were not checked." })];
    if (!found.certificates.length) return [result(sourceKey, { ...base, datasetVersion: found.datasetVersion, status: "no_match", coverage: "partial", message: "No certificate in the imported extract carries this UPRN. Certificates without a UPRN cannot be matched, so this is not proof that none exists." })];
    const records: ProviderRecord[] = found.certificates.map((certificate, index) => ({
      sourceRecordId: certificate.certificateKey,
      category: "energy_certificate_scotland",
      // No address field is stored or returned.
      data: { latest: index === 0, currentRating: certificate.currentRating, potentialRating: certificate.potentialRating, propertyType: certificate.propertyType, builtForm: certificate.builtForm, constructionAgeBand: certificate.constructionAgeBand, lodgementDate: certificate.lodgementDate, totalFloorAreaM2: certificate.totalFloorAreaM2 },
      evidence: [{ label: "Scottish EPC Register data extracts", url: "https://statistics.gov.scot/data/domestic-energy-performance-certificates" }],
      matchMethod: "uprn_exact",
      confidence: "high",
      sourceUpdatedAt: null,
    }));
    return [result(sourceKey, { ...base, datasetVersion: found.datasetVersion, status: "matched", records, coverage: "partial", message: "Scottish EPC Register record: verify during inspection. Certificates may be out of date." })];
  },
};
